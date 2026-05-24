// ============================================================
// GET /api/legal — Legal Ledger listing.
// ============================================================
// Returns all legal cases with their status, lawyer, hearing date.
// Filters: status (NoticeSent / Filed / InCourt / Settled / Dropped
//          / Recovered / WrittenOff / all  — default 'open' = all except
//          Settled/Recovered/Dropped/WrittenOff)
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';

const TERMINAL = ['Settled', 'Dropped', 'Recovered', 'WrittenOff'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

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
    return res.json({ ok: true, data: { cases: [] } });
  }

  const status = typeof req.query.status === 'string' ? req.query.status : 'open';
  if (status === 'open') {
    conditions.push(`l.status NOT IN ('Settled','Dropped','Recovered','WrittenOff')`);
  } else if (status !== 'all') {
    conditions.push(`l.status = $${i++}`);
    params.push(status);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const cases = await query<any>(
      `SELECT
         l.*,
         a.id   AS account_id,
         a.exec AS exec,
         a.tier AS tier,
         a.bill AS current_outstanding
       FROM "LegalCase" l
       LEFT JOIN "Account" a ON a.party = l.party
       ${whereSql}
       ORDER BY
         CASE WHEN l.status IN ('NoticeSent','Filed','InCourt') THEN 0 ELSE 1 END,
         l."filedOn" DESC`,
      params
    );

    return res.json({ ok: true, data: { cases } });
  } catch (err: any) {
    console.error('[api/legal] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Legal query failed' });
  }
}
