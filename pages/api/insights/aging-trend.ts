// ============================================================
// GET /api/insights/aging-trend — RefreshSnapshot time-series.
// ============================================================
// Returns up to the most recent 90 snapshots ordered ASC by ts
// (so the chart can plot left-to-right). Each point includes the
// full aging breakdown so the chart can show stacked or single-line.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'insights')) return;

  try {
    const rows = await query<any>(
      `SELECT id, ts, "byWhom",
              "accountCount",
              total::float8 AS total,
              d30::float8 AS d30, d60::float8 AS d60,
              d90::float8 AS d90, d90p::float8 AS d90p,
              "activeHolds", "candidates"
         FROM "RefreshSnapshot"
        ORDER BY ts ASC
        LIMIT 90`
    );
    return res.json({ ok: true, snapshots: rows });
  } catch (err: any) {
    console.error('[api/insights/aging-trend] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Aging-trend query failed' });
  }
}
