// ============================================================
// PATCH /api/clients/[party] — edit ClientMaster contact info.
// ============================================================
// Body keys (any subset — only sent ones are updated):
//   phone1, phone2, whatsapp, email,
//   owner, ap, admin, vip ('YES' | 'NO'),
//   address, segment, notes
//
// If no ClientMaster row exists for this party, one is created.
// Every change is logged to AccountHistory.
//
// `party` in the URL is the business key (matches Account.party).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { audit } from '@/lib/audit';

const Body = z.object({
  phone1:   z.string().max(60).nullable().optional(),
  phone2:   z.string().max(60).nullable().optional(),
  whatsapp: z.string().max(60).nullable().optional(),
  email:    z.string().max(120).nullable().optional(),
  owner:    z.string().max(120).nullable().optional(),
  ap:       z.string().max(120).nullable().optional(),
  admin:    z.string().max(120).nullable().optional(),
  vip:      z.enum(['YES','NO']).nullable().optional(),
  address:  z.string().max(2000).nullable().optional(),
  segment:  z.string().max(60).nullable().optional(),
  notes:    z.string().max(5000).nullable().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'worklist')) return;

  const party = decodeURIComponent(String(req.query.party || ''));
  if (!party) return res.status(400).json({ ok: false, error: 'Missing party' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const body = parsed.data;

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  const existing = await queryOne<any>(`SELECT * FROM "ClientMaster" WHERE party = $1 LIMIT 1`, [party]);

  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  const historyEntries: Array<{ action: string; oldValue: string | null; newValue: string | null }> = [];

  // Build SET clause for each field in body
  (Object.keys(body) as Array<keyof typeof body>).forEach(key => {
    const newVal = (body as any)[key];
    const oldVal = existing ? existing[key] : null;
    if (newVal === undefined) return;
    if (newVal === oldVal) return;
    const column = key; // ClientMaster uses unquoted lowercase for these; field names already match Prisma column names
    // All these columns are unquoted in Postgres because Prisma generated them lowercase
    sets.push(`"${column}" = $${i++}`);
    params.push(newVal);
    historyEntries.push({
      action: `Contact · ${key}`,
      oldValue: oldVal ?? null,
      newValue: newVal ?? '(cleared)',
    });
  });

  try {
    await withTransaction(async (q) => {
      if (existing) {
        if (sets.length === 0) return;
        sets.push(`"updatedAt" = NOW()`);
        await q(`UPDATE "ClientMaster" SET ${sets.join(', ')} WHERE party = $${i++}`, [...params, party]);
      } else {
        // Create a minimal ClientMaster row
        const id = newId('cm');
        const cols: string[] = ['id', 'party', 'family', '"updatedAt"'];
        const vals: any[] = [id, party, acct.family];
        const placeholders: string[] = ['$1', '$2', '$3', 'NOW()'];
        let j = 4;
        (Object.keys(body) as Array<keyof typeof body>).forEach(key => {
          const v = (body as any)[key];
          if (v === undefined) return;
          cols.push(`"${key}"`);
          vals.push(v);
          placeholders.push(`$${j++}`);
        });
        await q(
          `INSERT INTO "ClientMaster" (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
          vals
        );
      }

      for (const h of historyEntries) {
        await q(
          `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, 'Portal')`,
          [newId('hist'), party, user.name, acct.cm, h.action, h.oldValue, h.newValue, acct.bill]
        );
      }

      await q(`UPDATE "Account" SET "lastTouched" = NOW(), "updatedAt" = NOW() WHERE party = $1`, [party]);
    });

    audit(req, user, 'CONTACT_UPDATE', party, body);
    return res.json({ ok: true, changed: historyEntries.length });
  } catch (err: any) {
    console.error('[api/clients/[party] PATCH] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Contact update failed' });
  }
}
