// ============================================================
// GET /api/families — Clients & Families summary.
// ============================================================
// Groups Account rows by family. Each row aggregates:
//   accountCount, totalOutstanding, activeHolds, candidates,
//   topTier (most severe), VIP flag (from any ClientMaster in family)
//
// Owner / admin only (per sidebar role gate).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  try {
    const rows = await query<any>(
      `SELECT
         COALESCE(a.family, '(no family)')                          AS family,
         COUNT(*)::int                                              AS account_count,
         COALESCE(SUM(a.bill), 0)::numeric                          AS total_outstanding,
         SUM(CASE WHEN a."onHold" = 'Active'    THEN 1 ELSE 0 END)::int AS active_holds,
         SUM(CASE WHEN a."onHold" = 'Candidate' THEN 1 ELSE 0 END)::int AS candidates,
         MIN(a.tier)                                                AS top_tier,
         BOOL_OR(EXISTS (
           SELECT 1 FROM "ClientMaster" cm
           WHERE cm.family = a.family AND cm.vip = 'YES'
         ))                                                         AS has_vip,
         -- Owing accounts that DON'T already have an open legal case.
         -- A family with 0 here is fully converted → hide the button.
         SUM(CASE WHEN a.bill > 0 AND NOT EXISTS (
           SELECT 1 FROM "LegalCase" lc
            WHERE lc.party = a.party
              AND lc.status NOT IN ('Settled','Dropped','Recovered','WrittenOff')
         ) THEN 1 ELSE 0 END)::int                                  AS owing_unconverted
       FROM "Account" a
       GROUP BY a.family
       ORDER BY total_outstanding DESC`,
      []
    );

    return res.json({
      ok: true,
      data: {
        families: rows.map((r: any) => ({
          family: r.family,
          accountCount: Number(r.account_count),
          totalOutstanding: Number(r.total_outstanding),
          activeHolds: Number(r.active_holds),
          candidates: Number(r.candidates),
          topTier: r.top_tier,
          hasVip: !!r.has_vip,
          owingUnconverted: Number(r.owing_unconverted),
        })),
      },
    });
  } catch (err: any) {
    console.error('[api/families] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Families query failed' });
  }
}
