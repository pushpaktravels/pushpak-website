// ============================================================
// POST /api/clients/create — add a brand-new client to the master.
// ============================================================
// Body: { party (name), family?, phone?, email?, segment?, notes? }
//
// Creates a row in the one client master ("Account", keyed by party) so the
// new client is immediately pickable on bookings, plus an optional
// "ClientMaster" contact card. We do NOT call FinBook here — client creation
// stays on the dry-run list until the Calico API is live; a later tracker
// upload reconciles by party name via the existing ON CONFLICT upsert, so this
// local row is never clobbered.
//
// Allowed for the booking/accounts desks (anyone who can edit a surface that
// needs to name a client). Idempotent: an existing party is returned as-is.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { canEditView } from '@/lib/views';
import { audit } from '@/lib/audit';

const CREATE_VIEWS = ['reservations', 'card-log', 'worklist', 'finbook'];

const Body = z.object({
  party:   z.string().min(2).max(120).transform(s => s.trim()),
  family:  z.string().max(120).optional().nullable(),
  phone:   z.string().max(60).optional().nullable(),
  email:   z.string().max(120).optional().nullable(),
  segment: z.string().max(60).optional().nullable(),
  notes:   z.string().max(2000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!CREATE_VIEWS.some(v => canEditView(user, v))) {
    return res.status(403).json({ ok: false, error: 'Not allowed to add a client' });
  }

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  // Idempotent: return the existing account if this party already exists.
  const existing = await queryOne<any>(`SELECT party, family, bill FROM "Account" WHERE party = $1 LIMIT 1`, [b.party]);
  if (existing) {
    return res.json({ ok: true, client: { party: existing.party, family: existing.family, outstanding: Number(existing.bill) || 0 }, existed: true });
  }

  try {
    await withTransaction(async (q) => {
      const acctId = newId('acct');
      await q(
        `INSERT INTO "Account" (id, party, family, "updatedAt")
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (party) DO NOTHING`,
        [acctId, b.party, b.family || null],
      );

      // Optional contact card.
      if (b.phone || b.email || b.segment || b.notes) {
        const cmId = newId('cm');
        await q(
          `INSERT INTO "ClientMaster" (id, party, family, phone1, email, segment, notes, "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (party) DO NOTHING`,
          [cmId, b.party, b.family || null, b.phone || null, b.email || null, b.segment || null, b.notes || null],
        );
      }

      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, NULL, NULL, 'Account created', NULL, $3, 0, 'Portal')`,
        [newId('hist'), b.party, `Created by ${user.name} (${user.execId})`],
      );
    });
    audit(req, user, 'CLIENT_CREATE', b.party, { family: b.family || null });
    return res.json({ ok: true, client: { party: b.party, family: b.family || null, outstanding: 0 } });
  } catch (err: any) {
    console.error('[api/clients/create] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Create client failed' });
  }
}
