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
         COALESCE(family, '(no family)')                          AS family,
         COUNT(*)::int                                            AS account_count,
         COALESCE(SUM(bill), 0)::numeric                          AS total_outstanding,
         SUM(CASE WHEN "onHold" = 'Active'    THEN 1 ELSE 0 END)::int AS active_holds,
         SUM(CASE WHEN "onHold" = 'Candidate' THEN 1 ELSE 0 END)::int AS candidates,
         MIN(tier)                                                AS top_tier,
         BOOL_OR(EXISTS (
           SELECT 1 FROM "ClientMaster" cm
           WHERE cm.family = "Account".family AND cm.vip = 'YES'
         ))                                                       AS has_vip
       FROM "Account"
       GROUP BY family
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
        })),
      },
    });
  } catch (err: any) {
    console.error('[api/families] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Families query failed' });
  }
}
