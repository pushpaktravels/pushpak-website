// ============================================================
// GET /api/activity/report — owner-only active-time aggregator.
// ============================================================
// Query params:
//   since  ISO date (default = today - 29 days)
//   until  ISO date (default = today)
//   user   userId (optional — narrow to one user)
//
// Response:
//   perUser  [{ userId, userName, execId, role, totalSec,
//               todaySec, weekSec, monthSec, lastPingAt, online }]
//   daily    [{ date, totalSec }]   — across all users in range
//   pages    [{ page, totalSec }]   — top 12 pages across range
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

function todayIST(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 5);
  d.setUTCMinutes(d.getUTCMinutes() + 30);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'activity')) return;

  const until = (typeof req.query.until === 'string' && req.query.until) || todayIST();
  const since = (typeof req.query.since === 'string' && req.query.since)
    || new Date(Date.now() - 29 * 86400 * 1000).toISOString().slice(0, 10);
  const oneUser = typeof req.query.user === 'string' ? req.query.user : '';

  const userFilter = oneUser ? `AND ad."userId" = $${3}` : '';
  const params: any[] = [since, until];
  if (oneUser) params.push(oneUser);

  // Per-user roll-up
  const perUser = await query<any>(
    `SELECT
        u.id AS "userId",
        u.name AS "userName",
        u."execId",
        u.role,
        COALESCE(SUM(CASE WHEN ad.date BETWEEN $1::date AND $2::date THEN ad."activeSec" ELSE 0 END), 0)::int AS "totalSec",
        COALESCE(SUM(CASE WHEN ad.date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date     THEN ad."activeSec" ELSE 0 END), 0)::int AS "todaySec",
        COALESCE(SUM(CASE WHEN ad.date >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '6 days'   THEN ad."activeSec" ELSE 0 END), 0)::int AS "weekSec",
        COALESCE(SUM(CASE WHEN ad.date >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '29 days'  THEN ad."activeSec" ELSE 0 END), 0)::int AS "monthSec",
        MAX(ad."lastPingAt") AS "lastPingAt"
       FROM "User" u
       LEFT JOIN "ActivityDay" ad ON ad."userId" = u.id
      WHERE u.active = true ${oneUser ? `AND u.id = $3` : ''}
      GROUP BY u.id, u.name, u."execId", u.role
      ORDER BY "totalSec" DESC, u.name`,
    oneUser ? [since, until, oneUser] : [since, until]
  );

  // Daily totals
  const daily = await query<any>(
    `SELECT date::text AS date, SUM("activeSec")::int AS "totalSec"
       FROM "ActivityDay" ad
      WHERE date BETWEEN $1::date AND $2::date ${userFilter}
      GROUP BY date
      ORDER BY date ASC`,
    params
  );

  // Page breakdown (sum across all days in range)
  const pageRowsRaw = await query<any>(
    `SELECT "pageBreakdown" FROM "ActivityDay" ad
      WHERE date BETWEEN $1::date AND $2::date ${userFilter}`,
    params
  );
  const pageTotals = new Map<string, number>();
  for (const row of pageRowsRaw) {
    const b = row.pageBreakdown || {};
    for (const [page, sec] of Object.entries(b)) {
      pageTotals.set(page, (pageTotals.get(page) || 0) + Number(sec));
    }
  }
  const pages = Array.from(pageTotals.entries())
    .map(([page, totalSec]) => ({ page, totalSec }))
    .sort((a, b) => b.totalSec - a.totalSec)
    .slice(0, 12);

  // Mark "online" — last ping within 2 minutes (120s)
  const now = Date.now();
  const enriched = perUser.map((u: any) => ({
    ...u,
    online: u.lastPingAt && (now - +new Date(u.lastPingAt)) < 120_000,
  }));

  return res.json({
    ok: true,
    perUser: enriched,
    daily,
    pages,
    range: { since, until },
  });
}
