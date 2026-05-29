// ============================================================
// POST /api/promises — add a new promise on an account.
// ============================================================
// Body:
//   party          string (required)
//   expectedBy     ISO date (required)
//   outstandingAt  number (required) — outstanding at time of promise
//   note           string (optional)
//
// What it does, transactionally:
//   1) INSERT Promise (status = Open, exec = current user.name)
//   2) INSERT AccountHistory: action 'Promise added',
//      newValue = "₹X by date"
//   3) UPDATE Account.lastTouched = NOW()
//   4) INSERT PointEvent: +2 PROMISE_ADDED for the exec
//   5) audit() — best-effort
//
// Auth: visibleExecNames gate.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { fmtINR, fmtDate } from '@/lib/fmt';

const Body = z.object({
  party: z.string().min(1).max(200),
  expectedBy: z.string().min(8), // ISO date
  outstandingAt: z.number().nonnegative().max(1e12),
  note: z.string().max(2000).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'promises')) return;

  // ─── GET: Promise Ledger listing ────────────────────────────
  if (req.method === 'GET') {
    return handleList(req, res, user);
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!requireViewEdit(user, res, 'promises')) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { party, expectedBy, outstandingAt, note } = parsed.data;

  // Lookup + visibility
  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Party not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  const promiseId = newId('pr');
  const historyValue = `${fmtINR(outstandingAt)} by ${fmtDate(expectedBy)}`;

  try {
    await withTransaction(async (q) => {
      // Insert the promise
      await q(
        `INSERT INTO "Promise"
          (id, party, family, "expectedBy", exec, "outstandingAt", status, "amountReceived", notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'Open', 0, $7)`,
        [promiseId, party, acct.family, expectedBy, user.name, outstandingAt, note || null]
      );

      // Timeline entry
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, $3, $4, 'Promise added', $5, $6, 'Portal')`,
        [newId('hist'), party, user.name, acct.cm, historyValue, acct.bill]
      );

      // Bump lastTouched
      await q(
        `UPDATE "Account" SET "lastTouched" = NOW(), "updatedAt" = NOW() WHERE party = $1`,
        [party]
      );

      // Point event
      await q(
        `INSERT INTO "PointEvent" (id, ts, exec, event, party, points, detail)
         VALUES ($1, NOW(), $2, 'PROMISE_ADDED', $3, 2, $4)`,
        [newId('pt'), user.name, party, historyValue]
      );
    });

    audit(req, user, 'PROMISE_ADD', party, { expectedBy, outstandingAt, note });

    return res.json({ ok: true, promiseId });
  } catch (err: any) {
    console.error('[api/promises] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Add promise failed' });
  }
}

// ─── GET /api/promises — Promise Ledger listing ───────────────
// Query params:
//   status=Open|Kept|Broken|Cancelled|all (default: all)
//   limit (default 200, max 500)
//
// Visibility: respects visibleExecNames via a JOIN to Account.
// Sorted: Open first (oldest expectedBy first), then by expectedBy DESC.
async function handleList(req: NextApiRequest, res: NextApiResponse, user: any) {
  const visible = visibleExecNames(user);

  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map(() => `$${i++}`).join(',');
    conditions.push(`a.exec IN (${placeholders})`);
    params.push(...arr);
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, data: { promises: [] } });
  }

  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  if (status !== 'all' && ['Open','Kept','Broken','Cancelled'].includes(status)) {
    conditions.push(`p.status = $${i++}`);
    params.push(status);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  try {
    const rows = await query<any>(
      `SELECT
         p.id, p.party, p.family, p."expectedBy", p.exec,
         p."outstandingAt", p.status, p."amountReceived",
         p."settledOn", p.notes, p."loggedAt",
         a.id   AS account_id,
         a.tier AS tier,
         a."onHold" AS hold,
         CASE
           WHEN p.status = 'Open' AND p."expectedBy" < NOW()
             THEN EXTRACT(DAY FROM NOW() - p."expectedBy")::int
           ELSE NULL
         END AS days_overdue
       FROM "Promise" p
       LEFT JOIN "Account" a ON a.party = p.party
       ${whereSql}
       ORDER BY
         CASE WHEN p.status = 'Open' THEN 0 ELSE 1 END,
         CASE WHEN p.status = 'Open' THEN p."expectedBy" END ASC,
         p."expectedBy" DESC
       LIMIT ${limit}`,
      params
    );

    return res.json({ ok: true, data: { promises: rows } });
  } catch (err: any) {
    console.error('[api/promises GET] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Promise list query failed' });
  }
}
