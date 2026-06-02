// ============================================================
// /api/marketing/overview — the marketing desk's funnel dashboard.
// ============================================================
// Pure read over the shared Lead table (no marketing-specific table):
// the lead funnel by stage, the channel mix by source, where leads get
// routed by department, and headline conversion / pipeline value.
//
// Gated on the 'marketing' view (owner/admin + marketing). Optional
// ?days=<n> windows everything to leads created in the last n days.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'marketing')) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Optional time window. 0 / missing = all-time.
  const daysRaw = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : 0;
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 3650) : 0;
  const windowSql = days > 0 ? `WHERE "createdAt" >= NOW() - INTERVAL '${days} days'` : '';

  try {
    const [byStage, bySource, byDept, totalsRows] = await Promise.all([
      query<any>(`SELECT stage, COUNT(*)::int AS n FROM "Lead" ${windowSql} GROUP BY stage`),
      query<any>(`SELECT source, COUNT(*)::int AS n FROM "Lead" ${windowSql} GROUP BY source ORDER BY n DESC`),
      query<any>(`SELECT COALESCE(department,'(unrouted)') AS department, COUNT(*)::int AS n
                    FROM "Lead" ${windowSql} GROUP BY department ORDER BY n DESC`),
      query<any>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE stage NOT IN ('won','lost'))::int AS active,
          COUNT(*) FILTER (WHERE stage = 'won')::int AS won,
          COUNT(*) FILTER (WHERE stage = 'lost')::int AS lost,
          COALESCE(SUM("estValue") FILTER (WHERE stage = 'won'), 0) AS won_value,
          COALESCE(SUM("estValue") FILTER (WHERE stage NOT IN ('won','lost')), 0) AS pipeline_value
        FROM "Lead" ${windowSql}
      `),
    ]);

    const t = totalsRows[0] || { total: 0, active: 0, won: 0, lost: 0, won_value: 0, pipeline_value: 0 };
    const settled = Number(t.won) + Number(t.lost);
    const conversionPct = settled === 0 ? null : Math.round((Number(t.won) / settled) * 100);

    const stageCounts: Record<string, number> = {};
    byStage.forEach((r: any) => { stageCounts[r.stage] = r.n; });

    return res.json({
      ok: true,
      data: {
        window: days || 'all',
        totals: {
          total: Number(t.total),
          active: Number(t.active),
          won: Number(t.won),
          lost: Number(t.lost),
          wonValue: Number(t.won_value),
          pipelineValue: Number(t.pipeline_value),
          conversionPct,
        },
        byStage: stageCounts,
        bySource,
        byDepartment: byDept,
      },
    });
  } catch (err: any) {
    console.error('[api/marketing/overview] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Marketing overview failed' });
  }
}
