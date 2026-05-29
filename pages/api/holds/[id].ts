// ============================================================
// PATCH /api/holds/[id] — change a hold's status.
// ============================================================
// Body:
//   status   'Active' | 'Released' (required)
//   note     string (optional) — appended to AccountHistory
//
// Transitions allowed:
//   Candidate → Active   (Approve — owner/admin/cm only)
//   Candidate → Released (Drop the proposal — owner/admin/cm)
//   Active    → Released (Release — owner/admin/cm only)
//
// Also updates the parent Account.onHold so list views reflect
// the change immediately.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames, hasRole } from '@/lib/auth';
import { audit } from '@/lib/audit';

const Body = z.object({
  status: z.enum(['Active', 'Released']),
  note: z.string().max(2000).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  if (!hasRole(user, 'owner', 'admin', 'cm-accounts')) {
    return res.status(403).json({ ok: false, error: 'Only Owner/Admin/CM can change hold status' });
  }

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { status, note } = parsed.data;

  const hold = await queryOne<any>(`SELECT * FROM "HoldRecord" WHERE id = $1 LIMIT 1`, [id]);
  if (!hold) return res.status(404).json({ ok: false, error: 'Hold not found' });
  if (hold.status === 'Released') return res.status(409).json({ ok: false, error: 'Hold is already released' });
  if (hold.status === 'Active' && status === 'Active') return res.status(409).json({ ok: false, error: 'Hold is already active' });

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [hold.party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  const now = new Date().toISOString();
  const actionLabel = status === 'Active' ? 'Hold approved' : 'Hold released';

  try {
    await withTransaction(async (q) => {
      if (status === 'Active') {
        await q(
          `UPDATE "HoldRecord"
             SET status = 'Active', "confirmedBy" = $1, "confirmedOn" = $2
           WHERE id = $3`,
          [user.name, now, id]
        );
      } else {
        await q(
          `UPDATE "HoldRecord"
             SET status = 'Released', "releasedBy" = $1, "releasedOn" = $2
           WHERE id = $3`,
          [user.name, now, id]
        );
      }

      // Mirror onto Account.onHold (null when released)
      await q(
        `UPDATE "Account" SET "onHold" = $1, "lastTouched" = NOW(), "updatedAt" = NOW() WHERE party = $2`,
        [status === 'Released' ? null : 'Active', hold.party]
      );

      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, 'Portal')`,
        [newId('hist'), hold.party, user.name, acct.cm, actionLabel, note || hold.reason, acct.bill]
      );
    });

    audit(req, user, status === 'Active' ? 'HOLD_APPROVE' : 'HOLD_RELEASE', hold.party, { holdId: id, note });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[api/holds/[id]] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Hold update failed' });
  }
}
