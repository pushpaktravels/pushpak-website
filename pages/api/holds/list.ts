// ============================================================
// GET /api/holds/list — all current Candidate + Active holds.
// ============================================================
// Used by the Hold Check page to render the two boards below the
// search bar. Each row joins the HoldRecord with the parent Account
// for the data the page needs to show + act on.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'hold-check')) return;

  const visible = visibleExecNames(user);
  const params: any[] = [];
  let scopeFilter = '';
  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map((_, i) => `$${i + 1}`).join(',');
    scopeFilter = `AND (a.exec IS NULL OR UPPER(a.exec) IN (${placeholders}))`;
    params.push(...arr);
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, candidates: [], active: [] });
  }

  try {
    const rows = await query<any>(
      `SELECT h.id, h.party, h.family, h.outstanding::float8 AS outstanding,
              h.reason, h.status, h."confirmedBy", h."confirmedOn", h."addedOn",
              a.id AS "accountId", a.exec, a.tier, a.bill::float8 AS bill,
              a.d90p::float8 AS d90p
         FROM "HoldRecord" h
         LEFT JOIN "Account" a ON a.party = h.party
        WHERE h.status IN ('Candidate', 'Active') ${scopeFilter}
        ORDER BY
          CASE h.status WHEN 'Active' THEN 0 ELSE 1 END,
          h.outstanding DESC NULLS LAST`,
      params
    );
    const candidates = rows.filter(r => r.status === 'Candidate');
    const active     = rows.filter(r => r.status === 'Active');
    return res.json({ ok: true, candidates, active });
  } catch (err: any) {
    console.error('[api/holds/list] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Failed' });
  }
}
