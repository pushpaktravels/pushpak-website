// ============================================================
// GET /api/insights — owner/analyst analytics dashboard.
// ============================================================
// Recovery-focused layout. Returns:
//   summary           — top-line KPIs with deltas vs previous 30d
//   collectionsTrend  — daily recovered totals last 90d (line chart)
//   promiseStats      — counts by status (Open/Kept/Broken/Cancelled)
//   leaderboard       — per-exec performance last 30d:
//                       recovered$ · calls · promises kept/broken/added
//   agingMix          — total in each aging bucket (current snapshot)
//   topAccounts       — top 10 by outstanding
//   families          — top 10 family concentration
//   stale             — top 10 accounts not touched > 7d
//   critical          — top 10 D/E tier accounts
//   holds             — active/candidate hold counts + total at risk
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin', 'insights')) return;

  try {
    const [
      summary, trend, promiseStats, leaderboard,
      agingMix, topAccounts, families, stale, critical, holds,
      recoveredPrev30, recoveredLast30, callsCurrent, callsPrev,
    ] = await Promise.all([
      // 1) Account summary
      queryOne<any>(
        `SELECT
           COUNT(*)::int                                                                       AS total_accounts,
           COALESCE(SUM(bill), 0)::numeric                                                    AS total_outstanding,
           SUM(CASE WHEN "onHold" = 'Active'    THEN 1 ELSE 0 END)::int                       AS active_holds,
           SUM(CASE WHEN tier IN ('D','E')      THEN 1 ELSE 0 END)::int                       AS critical_count,
           COALESCE(SUM(CASE WHEN tier IN ('D','E') THEN bill ELSE 0 END), 0)::numeric        AS critical_value,
           SUM(CASE WHEN "lastTouched" IS NULL OR "lastTouched" < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS stale_count
         FROM "Account"`,
        []
      ),

      // 2) Collections trend — last 90 days
      query<any>(
        `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS day,
                COALESCE(SUM(amount), 0)::numeric AS total
         FROM "CollectionLog"
         WHERE date >= NOW() - INTERVAL '90 days'
         GROUP BY day
         ORDER BY day ASC`,
        []
      ),

      // 3) Promise status mix (last 90 days)
      query<any>(
        `SELECT status, COUNT(*)::int AS count
         FROM "Promise"
         WHERE "loggedAt" >= NOW() - INTERVAL '90 days'
         GROUP BY status`,
        []
      ),

      // 4) Leaderboard — per-exec performance last 30 days
      query<any>(
        `WITH recoveries AS (
           SELECT exec, COALESCE(SUM(amount), 0)::numeric AS recovered
           FROM "CollectionLog"
           WHERE date >= NOW() - INTERVAL '30 days' AND exec IS NOT NULL
           GROUP BY exec
         ),
         calls AS (
           SELECT exec, COUNT(*)::int AS calls
           FROM "PointEvent"
           WHERE event = 'CALL' AND ts >= NOW() - INTERVAL '30 days'
           GROUP BY exec
         ),
         promises AS (
           SELECT exec,
                  SUM(CASE WHEN status = 'Kept'   THEN 1 ELSE 0 END)::int AS kept,
                  -- On time: kept AND settled on or before the promised day.
                  SUM(CASE WHEN status = 'Kept' AND "settledOn"::date <= "expectedBy"::date THEN 1 ELSE 0 END)::int AS kept_on_time,
                  SUM(CASE WHEN status = 'Broken' THEN 1 ELSE 0 END)::int AS broken,
                  SUM(CASE WHEN status = 'Open'   THEN 1 ELSE 0 END)::int AS open,
                  COUNT(*)::int AS total
           FROM "Promise"
           WHERE "loggedAt" >= NOW() - INTERVAL '30 days' AND exec IS NOT NULL
           GROUP BY exec
         ),
         book AS (
           SELECT exec, COUNT(*)::int AS accounts, COALESCE(SUM(bill), 0)::numeric AS outstanding
           FROM "Account"
           WHERE exec IS NOT NULL
           GROUP BY exec
         )
         SELECT
           COALESCE(r.exec, c.exec, p.exec, b.exec) AS exec,
           COALESCE(r.recovered, 0)::numeric        AS recovered,
           COALESCE(c.calls, 0)::int                AS calls,
           COALESCE(p.kept, 0)::int                 AS promises_kept,
           COALESCE(p.kept_on_time, 0)::int         AS promises_kept_on_time,
           COALESCE(p.broken, 0)::int               AS promises_broken,
           COALESCE(p.open, 0)::int                 AS promises_open,
           COALESCE(p.total, 0)::int                AS promises_total,
           COALESCE(b.accounts, 0)::int             AS accounts,
           COALESCE(b.outstanding, 0)::numeric      AS outstanding
         FROM recoveries r
         FULL OUTER JOIN calls    c ON c.exec = r.exec
         FULL OUTER JOIN promises p ON p.exec = COALESCE(r.exec, c.exec)
         FULL OUTER JOIN book     b ON b.exec = COALESCE(r.exec, c.exec, p.exec)
         WHERE COALESCE(r.exec, c.exec, p.exec, b.exec) IS NOT NULL
         ORDER BY recovered DESC, calls DESC`,
        []
      ),

      // 5) Aging mix (current snapshot)
      queryOne<any>(
        `SELECT
           COALESCE(SUM(d30), 0)::numeric  AS d30,
           COALESCE(SUM(d60), 0)::numeric  AS d60,
           COALESCE(SUM(d90), 0)::numeric  AS d90,
           COALESCE(SUM(d90p), 0)::numeric AS d90p
         FROM "Account"`,
        []
      ),

      // 6) Top 10 accounts
      query<any>(
        `SELECT id, party, family, exec, tier, bill, "onHold"
         FROM "Account"
         WHERE bill > 0
         ORDER BY bill DESC
         LIMIT 10`,
        []
      ),

      // 7) Family concentration (top 10)
      query<any>(
        `SELECT
           COALESCE(family, '(no family)') AS family,
           COUNT(*)::int                    AS account_count,
           COALESCE(SUM(bill), 0)::numeric  AS total,
           SUM(CASE WHEN "onHold" = 'Active' THEN 1 ELSE 0 END)::int AS active_holds
         FROM "Account"
         GROUP BY family
         ORDER BY total DESC
         LIMIT 10`,
        []
      ),

      // 8) Stale accounts — top 10 by bill, not touched in 7d
      query<any>(
        `SELECT id, party, family, exec, tier, bill, "lastTouched"
         FROM "Account"
         WHERE ("lastTouched" IS NULL OR "lastTouched" < NOW() - INTERVAL '7 days')
           AND bill > 0
         ORDER BY bill DESC
         LIMIT 10`,
        []
      ),

      // 9) Critical accounts (D/E tier, top 10)
      query<any>(
        `SELECT id, party, family, exec, tier, bill, "onHold", status
         FROM "Account"
         WHERE tier IN ('D','E') AND bill > 0
         ORDER BY bill DESC
         LIMIT 10`,
        []
      ),

      // 10) Hold breakdown
      queryOne<any>(
        `SELECT
           SUM(CASE WHEN "onHold" = 'Active'    THEN 1 ELSE 0 END)::int AS active_count,
           SUM(CASE WHEN "onHold" = 'Candidate' THEN 1 ELSE 0 END)::int AS candidate_count,
           COALESCE(SUM(CASE WHEN "onHold" = 'Active'    THEN bill ELSE 0 END), 0)::numeric AS active_value,
           COALESCE(SUM(CASE WHEN "onHold" = 'Candidate' THEN bill ELSE 0 END), 0)::numeric AS candidate_value
         FROM "Account"`,
        []
      ),

      // 11-14) Period-over-period deltas (last 30d vs previous 30d)
      queryOne<any>(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS total
         FROM "CollectionLog"
         WHERE date >= NOW() - INTERVAL '60 days' AND date < NOW() - INTERVAL '30 days'`,
        []
      ),
      queryOne<any>(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS total
         FROM "CollectionLog"
         WHERE date >= NOW() - INTERVAL '30 days'`,
        []
      ),
      queryOne<any>(
        `SELECT COUNT(*)::int AS total
         FROM "PointEvent"
         WHERE event = 'CALL' AND ts >= NOW() - INTERVAL '30 days'`,
        []
      ),
      queryOne<any>(
        `SELECT COUNT(*)::int AS total
         FROM "PointEvent"
         WHERE event = 'CALL' AND ts >= NOW() - INTERVAL '60 days' AND ts < NOW() - INTERVAL '30 days'`,
        []
      ),
    ]);

    // Compute promise kept rate
    const totalSettled = (promiseStats || []).reduce((n: number, p: any) =>
      n + (p.status === 'Kept' || p.status === 'Broken' ? Number(p.count) : 0), 0);
    const totalKept = (promiseStats || []).reduce((n: number, p: any) =>
      n + (p.status === 'Kept' ? Number(p.count) : 0), 0);
    const keptRate = totalSettled === 0 ? null : Math.round((totalKept / totalSettled) * 100);

    // Compute per-exec kept-rate AND on-time rate (kept by the promised date ÷
    // everything that came due). Both null when nothing settled in the window.
    const leaderboardWithRates = (leaderboard || []).map((row: any) => {
      const settled = Number(row.promises_kept) + Number(row.promises_broken);
      const keptPct = settled === 0 ? null : Math.round(Number(row.promises_kept) / settled * 100);
      const onTimePct = settled === 0 ? null : Math.round(Number(row.promises_kept_on_time) / settled * 100);
      return { ...row, kept_rate: keptPct, on_time_rate: onTimePct };
    });

    return res.json({
      ok: true,
      data: {
        summary,
        recoveredLast30: Number(recoveredLast30?.total || 0),
        recoveredPrev30: Number(recoveredPrev30?.total || 0),
        callsCurrent: Number(callsCurrent?.total || 0),
        callsPrev: Number(callsPrev?.total || 0),
        keptRate,
        collectionsTrend: trend,
        promiseStats,
        leaderboard: leaderboardWithRates,
        agingMix,
        topAccounts,
        families,
        stale,
        critical,
        holds,
      },
    });
  } catch (err: any) {
    console.error('[api/insights] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Insights query failed' });
  }
}
