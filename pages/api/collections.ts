// ============================================================
// GET /api/collections — Collection List.
// ============================================================
// Returns payment events recorded in CollectionLog. Default
// window: last 90 days. Optional ?days=N override.
// Sorted: newest date first.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const visible = visibleExecNames(user);
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 730);

  const conditions: string[] = [`c.date >= NOW() - INTERVAL '${days} days'`];
  const params: any[] = [];
  let i = 1;

  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map(() => `$${i++}`).join(',');
    conditions.push(`(c.exec IN (${placeholders}) OR c.exec IS NULL)`);
    params.push(...arr);
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, data: { collections: [], totalAmount: 0 } });
  }

  const whereSql = `WHERE ${conditions.join(' AND ')}`;

  try {
    const rows = await query<any>(
      `SELECT
         c.*,
         a.id   AS account_id,
         a.tier AS tier
       FROM "CollectionLog" c
       LEFT JOIN "Account" a ON a.party = c.party
       ${whereSql}
       ORDER BY c.date DESC, c.id DESC
       LIMIT 500`,
      params
    );

    const totalAmount = rows.reduce((n: number, r: any) => n + Number(r.amount || 0), 0);
    return res.json({ ok: true, data: { collections: rows, totalAmount } });
  } catch (err: any) {
    console.error('[api/collections] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Collections query failed' });
  }
}
