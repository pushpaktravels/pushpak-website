// ============================================================
// GET /api/dashboard — aggregate KPIs for the dashboard view.
// ============================================================
// Uses node-postgres (lib/pg) directly. Prisma is bypassed at
// runtime to dodge the Prisma + Supabase pgbouncer prepared-
// statement bug (even $queryRawUnsafe trips it).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const visible = visibleExecNames(user);

  // Build a parameterised WHERE clause. Exec names go in as $1, $2, …
  let whereSql = '';
  let whereParams: string[] = [];
  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map((_, i) => `$${i + 1}`).join(',');
    whereSql = `WHERE exec IN (${placeholders})`;
    whereParams = arr;
  } else if (visible !== null && visible.size === 0) {
    // CM with empty team and no matching name → see nothing
    whereSql = `WHERE 1=0`;
  }

  try {
    const [totals, tiers, lastRefresh, credits] = await Promise.all([
      query<any>(`
        SELECT
          COALESCE(SUM(bill), 0)::numeric         AS total,
          COUNT(*)::int                            AS accounts,
          COALESCE(SUM(d30), 0)::numeric           AS d30,
          COALESCE(SUM(d60), 0)::numeric           AS d60,
          COALESCE(SUM(d90), 0)::numeric           AS d90,
          COALESCE(SUM(d90p), 0)::numeric          AS d90p,
          SUM(CASE WHEN "onHold" = 'Active'    THEN 1 ELSE 0 END)::int AS hold_active,
          SUM(CASE WHEN "onHold" = 'Candidate' THEN 1 ELSE 0 END)::int AS hold_cand
        FROM "Account"
        ${whereSql}
      `, whereParams),
      query<any>(`
        SELECT tier, COUNT(*)::int AS count
        FROM "Account"
        ${whereSql}
        GROUP BY tier
      `, whereParams),
      query<any>(`
        SELECT ts, "byWhom", delta
        FROM "RefreshLog"
        ORDER BY ts DESC
        LIMIT 1
      `, []),
      // Customer credits — accounts owing us nothing (bill < 0).
      // These are advances / unadjusted refunds — the portal hides them
      // by default so this surfaces them on the Dashboard.
      query<any>(`
        SELECT id, party, family, exec,
               bill::float8 AS bill
          FROM "Account"
          ${whereSql ? whereSql + ' AND bill < 0' : 'WHERE bill < 0'}
          ORDER BY bill ASC
          LIMIT 50
      `, whereParams),
    ]);

    const t = totals[0] || {};
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    tiers.forEach((row: any) => { counts[row.tier] = Number(row.count); });
    const refresh = lastRefresh[0] || null;

    return res.json({
      ok: true,
      data: {
        total: Number(t.total || 0),
        accounts: Number(t.accounts || 0),
        d30: Number(t.d30 || 0),
        d60: Number(t.d60 || 0),
        d90: Number(t.d90 || 0),
        d90p: Number(t.d90p || 0),
        counts,
        onHoldActive: Number(t.hold_active || 0),
        onHoldCandidate: Number(t.hold_cand || 0),
        lastRefreshAt: refresh?.ts || null,
        lastRefreshBy: refresh?.byWhom || null,
        lastRefreshDelta: refresh?.delta != null ? Number(refresh.delta) : null,
        credits: credits.map((r: any) => ({
          id: r.id, party: r.party, family: r.family,
          exec: r.exec, bill: Number(r.bill),
        })),
        creditTotal: credits.reduce((s: number, r: any) => s + Number(r.bill), 0),
      },
    });
  } catch (err: any) {
    console.error('[api/dashboard] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Dashboard query failed' });
  }
}
