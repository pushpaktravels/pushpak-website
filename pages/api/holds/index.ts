// ============================================================
// POST /api/holds — flag a new hold record on an account.
// ============================================================
// Body:
//   party        string (required)
//   reason       string (required)
//   status       'Candidate' | 'Active' (default 'Candidate')
//
// Candidate = exec proposes the hold (visible in Hold Check list
//             with amber pill, but bookings can still proceed)
// Active    = owner/admin/CM approves it; bookings blocked
//
// Auth:
//   Candidate creation: any exec can flag
//   Active creation:    owner / admin / cm only (matches legacy rule)
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames, hasRole } from '@/lib/auth';
import { audit } from '@/lib/audit';

const Body = z.object({
  party: z.string().min(1).max(200),
  reason: z.string().min(3).max(2000),
  status: z.enum(['Candidate', 'Active']).default('Candidate'),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { party, reason, status } = parsed.data;

  // Creating an Active hold straight away requires owner/admin/cm
  if (status === 'Active' && !hasRole(user, 'owner', 'admin', 'cm')) {
    return res.status(403).json({ ok: false, error: 'Only Owner/Admin/CM can create an Active hold directly' });
  }

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Party not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  const holdId = newId('hr');
  const actionLabel = status === 'Active' ? 'Hold activated' : 'Hold flagged';

  try {
    await withTransaction(async (q) => {
      await q(
        `INSERT INTO "HoldRecord"
          (id, party, family, outstanding, reason, status, "confirmedBy", "confirmedOn")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [holdId, party, acct.family, acct.bill, reason, status,
         status === 'Active' ? user.name : null,
         status === 'Active' ? new Date().toISOString() : null]
      );

      // Mirror onto Account.onHold so list views show the pill
      await q(
        `UPDATE "Account" SET "onHold" = $1, "lastTouched" = NOW(), "updatedAt" = NOW() WHERE party = $2`,
        [status, party]
      );

      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, 'Portal')`,
        [newId('hist'), party, user.name, acct.cm, actionLabel, reason, acct.bill]
      );

      // PointEvent: HOLD_NEW = +3
      await q(
        `INSERT INTO "PointEvent" (id, ts, exec, event, party, points, detail)
         VALUES ($1, NOW(), $2, 'HOLD_NEW', $3, 3, $4)`,
        [newId('pt'), user.name, party, reason]
      );
    });

    audit(req, user, status === 'Active' ? 'HOLD_ACTIVATE' : 'HOLD_FLAG', party, { reason });

    return res.json({ ok: true, holdId });
  } catch (err: any) {
    console.error('[api/holds] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Flag hold failed' });
  }
}
