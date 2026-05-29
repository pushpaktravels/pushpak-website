// ============================================================
// POST /api/log-call — log a call against an account.
// ============================================================
// Body:
//   party       string (required)
//   outcome     string (required) — "Spoke to AP", "VM left", etc.
//   note        string (optional)
//   nextFu      ISO date (optional) — auto-bumps Account.nextFu
//   status      string (optional) — manually advance Account.status
//
// What it does, transactionally:
//   1) UPDATE Account: recentCall = NOW(), callOutcome, lastTouched,
//      stageCalls += 1, optional nextFu / status, prepend history note
//   2) INSERT AccountHistory: action 'Call logged', newValue = outcome
//   3) INSERT PointEvent: +1 CALL for the exec
//   4) audit() — best-effort AuditLog write
//
// Auth: visibleExecNames gate (CMs can only log calls on their team's
// accounts; owner/admin/analyst can act on anything).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const Body = z.object({
  party: z.string().min(1).max(200),
  outcome: z.string().min(1).max(200),
  status: z.string().max(60).optional(),
  nextFu: z.string().optional(),
  note: z.string().max(2000).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'worklist')) return;
  if (!requireViewEdit(user, res, 'worklist')) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { party, outcome, status, nextFu, note } = parsed.data;

  // 1) Lookup account + visibility check
  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Party not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  // 2) Build optional inline history note (prepended to existing freeform history)
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:MM
  const historyEntry = note
    ? `[${stamp} • ${user.name}] ${note} — ${outcome}`
    : null;
  const newHistoryText = historyEntry
    ? (acct.history ? `${historyEntry}\n\n${acct.history}` : historyEntry)
    : acct.history;

  // 3) Transactional writes
  try {
    await withTransaction(async (q) => {
      // Account update
      await q(
        `UPDATE "Account" SET
           "recentCall" = NOW(),
           "callOutcome" = $1,
           "nextFu" = COALESCE($2::timestamp, "nextFu"),
           status = COALESCE($3, status),
           "lastTouched" = NOW(),
           "stageCalls" = "stageCalls" + 1,
           history = $4,
           "updatedAt" = NOW()
         WHERE party = $5`,
        [outcome, nextFu || null, status || null, newHistoryText, party]
      );

      // AccountHistory entry (drives the Timeline tab)
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, $3, $4, 'Call logged', $5, $6, 'Portal')`,
        [newId('hist'), party, user.name, acct.cm, outcome, acct.bill]
      );

      // PointEvent — +1 for the CALL
      await q(
        `INSERT INTO "PointEvent" (id, ts, exec, event, party, points, detail)
         VALUES ($1, NOW(), $2, 'CALL', $3, 1, $4)`,
        [newId('pt'), user.name, party, outcome]
      );
    });

    // Audit — best-effort, outside the transaction (a failed audit must not roll back the call)
    audit(req, user, 'CALL_LOG', party, { outcome, nextFu, status, note });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[api/log-call] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Log call failed' });
  }
}
