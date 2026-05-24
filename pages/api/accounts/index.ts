// ============================================================
// GET /api/accounts — filterable account list.
// ============================================================
// Reused across Team Worklist drill-down, every ledger page,
// and the future search bar. Optional filters as query params:
//
//   exec=<NAME>             one exec
//   tier=<A|B|C|D|E>        one tier
//   onHold=<status>         Active / Candidate / clear
//   minOutstanding=<n>      bill >= n
//   q=<text>                ILIKE on party + family
//   limit=<n>               default 100, max 500
//
// Visibility: respects visibleExecNames(user).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const visible = visibleExecNames(user);

  // Build WHERE conditions and parameter array in parallel.
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  // Exec scoping (role-based)
  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map(() => `$${i++}`).join(',');
    conditions.push(`exec IN (${placeholders})`);
    params.push(...arr);
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, data: { accounts: [], total: 0 } });
  }

  // Optional filters from query string
  const exec = typeof req.query.exec === 'string' ? req.query.exec.toUpperCase() : null;
  const tier = typeof req.query.tier === 'string' ? req.query.tier.toUpperCase() : null;
  const onHold = typeof req.query.onHold === 'string' ? req.query.onHold : null;
  const minOut = typeof req.query.minOutstanding === 'string' ? Number(req.query.minOutstanding) : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (exec)   { conditions.push(`exec = $${i++}`);     params.push(exec); }
  if (tier)   { conditions.push(`tier = $${i++}`);     params.push(tier); }
  if (onHold) { conditions.push(`"onHold" = $${i++}`); params.push(onHold); }
  if (minOut != null && !isNaN(minOut)) {
    conditions.push(`bill >= $${i++}`); params.push(minOut);
  }
  if (q.length >= 2) {
    conditions.push(`(party ILIKE $${i} OR family ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  try {
    const accounts = await query<any>(
      `SELECT id, party, family, exec, cm, tier, alert, bill, d30, d60, d90, d90p,
              "onHold", status, "creditLimit", "creditPeriod", stage, "lastTouched"
       FROM "Account"
       ${whereSql}
       ORDER BY
         CASE WHEN "onHold" = 'Active' THEN 0
              WHEN "onHold" = 'Candidate' THEN 1
              ELSE 2 END,
         bill DESC
       LIMIT ${limit}`,
      params
    );

    return res.json({ ok: true, data: { accounts, total: accounts.length } });
  } catch (err: any) {
    console.error('[api/accounts] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Accounts query failed' });
  }
}
