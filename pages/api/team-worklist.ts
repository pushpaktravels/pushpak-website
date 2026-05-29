// ============================================================
// GET /api/team-worklist — manager's morning view.
// ============================================================
// Returns one summary row per visible exec:
//   accounts          — total accounts assigned
//   outstanding       — sum of bill
//   activeHolds       — count where onHold = 'Active'
//   holdCandidates    — count where onHold = 'Candidate'
//   criticalCount     — count where tier IN ('D','E')
//   staleCount        — count where lastTouched < 7d ago or null
//   overduePromises   — open promises whose expectedBy is past
//
// Sorted by outstanding DESC so the biggest exposure surfaces first.
// Visibility: owner/admin/analyst see all execs; CMs see only their team.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'team-worklist')) return;

  const visible = visibleExecNames(user);

  // Build optional WHERE clause for exec scoping.
  let whereSql = `WHERE exec IS NOT NULL AND exec <> ''`;
  let params: string[] = [];
  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map((_, i) => `$${i + 1}`).join(',');
    whereSql += ` AND exec IN (${placeholders})`;
    params = arr;
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, data: { execs: [] } });
  }

  try {
    // Q1 — per-exec account stats
    const stats = await query<any>(
      `SELECT
         exec,
         COUNT(*)::int                                                                  AS accounts,
         COALESCE(SUM(bill), 0)::numeric                                               AS outstanding,
         SUM(CASE WHEN "onHold" = 'Active'    THEN 1 ELSE 0 END)::int                  AS active_holds,
         SUM(CASE WHEN "onHold" = 'Candidate' THEN 1 ELSE 0 END)::int                  AS hold_candidates,
         SUM(CASE WHEN tier IN ('D','E')      THEN 1 ELSE 0 END)::int                  AS critical_count,
         SUM(CASE WHEN "lastTouched" IS NULL OR "lastTouched" < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS stale_count
       FROM "Account"
       ${whereSql}
       GROUP BY exec
       ORDER BY outstanding DESC`,
      params
    );

    // Q2 — overdue open promises per exec
    let pWhere = `WHERE p.status = 'Open' AND p."expectedBy" < NOW() AND a.exec IS NOT NULL AND a.exec <> ''`;
    if (visible !== null && visible.size > 0) {
      const arr = Array.from(visible);
      const start = params.length;
      const placeholders = arr.map((_, i) => `$${start + i + 1}`).join(',');
      pWhere += ` AND a.exec IN (${placeholders})`;
      params = [...params, ...arr];
    }
    const overdueRows = await query<any>(
      `SELECT a.exec, COUNT(*)::int AS overdue
       FROM "Promise" p
       INNER JOIN "Account" a ON a.party = p.party
       ${pWhere}
       GROUP BY a.exec`,
      params
    );
    const overdueByExec: Record<string, number> = {};
    overdueRows.forEach((r: any) => { overdueByExec[r.exec] = Number(r.overdue); });

    const execs = stats.map((r: any) => ({
      exec: r.exec,
      accounts: Number(r.accounts),
      outstanding: Number(r.outstanding),
      activeHolds: Number(r.active_holds),
      holdCandidates: Number(r.hold_candidates),
      criticalCount: Number(r.critical_count),
      staleCount: Number(r.stale_count),
      overduePromises: overdueByExec[r.exec] || 0,
    }));

    return res.json({ ok: true, data: { execs } });
  } catch (err: any) {
    console.error('[api/team-worklist] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Team worklist failed' });
  }
}
