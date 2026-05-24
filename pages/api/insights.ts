// ============================================================
// GET /api/insights — macro view for owner/analyst.
// ============================================================
// Returns three datasets in one call:
//   1) collectionsTrend — daily recovered totals over the last 90d
//   2) topAccounts      — top 10 by outstanding
//   3) familyConcentration — top 10 families by exposure
//
// Owner/analyst only (matches sidebar role gate).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin', 'analyst')) return;

  try {
    const [trend, topAccounts, families, summary] = await Promise.all([
      query<any>(
        `SELECT
           TO_CHAR(date, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(amount), 0)::numeric AS total
         FROM "CollectionLog"
         WHERE date >= NOW() - INTERVAL '90 days'
         GROUP BY day
         ORDER BY day ASC`,
        []
      ),
      query<any>(
        `SELECT id, party, family, exec, tier, bill, "onHold"
         FROM "Account"
         WHERE bill > 0
         ORDER BY bill DESC
         LIMIT 10`,
        []
      ),
      query<any>(
        `SELECT
           COALESCE(family, '(no family)') AS family,
           COUNT(*)::int                    AS account_count,
           COALESCE(SUM(bill), 0)::numeric  AS total
         FROM "Account"
         GROUP BY family
         ORDER BY total DESC
         LIMIT 10`,
        []
      ),
      query<any>(
        `SELECT
           COUNT(*)::int                                                                        AS total_accounts,
           COALESCE(SUM(bill), 0)::numeric                                                     AS total_outstanding,
           SUM(CASE WHEN "onHold" = 'Active'    THEN 1 ELSE 0 END)::int                        AS active_holds,
           SUM(CASE WHEN tier IN ('D','E')      THEN 1 ELSE 0 END)::int                        AS critical_count,
           SUM(CASE WHEN "lastTouched" IS NULL OR "lastTouched" < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS stale_count
         FROM "Account"`,
        []
      ),
    ]);

    return res.json({
      ok: true,
      data: {
        summary: summary[0],
        collectionsTrend: trend,
        topAccounts,
        families,
      },
    });
  } catch (err: any) {
    console.error('[api/insights] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Insights query failed' });
  }
}
