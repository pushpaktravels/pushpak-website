// ============================================================
// GET /api/scoreboard — exec leaderboard from PointEvent table.
// ============================================================
// Sums points per exec in a date window (default 30 days).
// Visibility: scoped to visibleExecNames; only execs with
// scoreboard=true in their User row appear in the leaderboard.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const visible = visibleExecNames(user);
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);

  const conditions: string[] = [`pe.ts >= NOW() - INTERVAL '${days} days'`];
  const params: any[] = [];
  let i = 1;

  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map(() => `$${i++}`).join(',');
    conditions.push(`pe.exec IN (${placeholders})`);
    params.push(...arr);
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, data: { rankings: [], days } });
  }

  const whereSql = `WHERE ${conditions.join(' AND ')}`;

  try {
    // Join against User to filter to scoreboard=true users.
    // Match on UPPER(u.name) because PointEvent.exec is stored uppercase.
    const rows = await query<any>(
      `SELECT
         pe.exec,
         COALESCE(SUM(pe.points), 0)::int                                                        AS points,
         COUNT(*)::int                                                                            AS event_count,
         SUM(CASE WHEN pe.event = 'CALL'           THEN 1 ELSE 0 END)::int                       AS calls,
         SUM(CASE WHEN pe.event = 'PROMISE_KEPT'   THEN 1 ELSE 0 END)::int                       AS kept,
         SUM(CASE WHEN pe.event = 'PROMISE_BROKEN' THEN 1 ELSE 0 END)::int                       AS broken,
         SUM(CASE WHEN pe.event = 'RECOVERY'       THEN 1 ELSE 0 END)::int                       AS recoveries
       FROM "PointEvent" pe
       INNER JOIN "User" u ON UPPER(u.name) = pe.exec AND u.scoreboard = true
       ${whereSql}
       GROUP BY pe.exec
       ORDER BY points DESC, calls DESC`,
      params
    );

    return res.json({ ok: true, data: { rankings: rows, days } });
  } catch (err: any) {
    console.error('[api/scoreboard] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Scoreboard query failed' });
  }
}
