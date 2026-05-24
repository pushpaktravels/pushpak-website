// ============================================================
// GET /api/hold-check?q=<party-name> — booking team's lookup.
// ============================================================
// Returns accounts whose party (or family) matches the query
// substring, with the fields the booking desk needs to make a
// go/no-go call:
//   bill (outstanding), tier, onHold status, alert, exec, family
//
// Uses ILIKE (case-insensitive) on party + family. Limits to 20
// results so a too-broad query never floods the page.
// No exec-visibility gating here — booking-team uses this view
// regardless of role; the data shown is non-sensitive enough.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ ok: true, data: [] });
  }

  try {
    const rows = await query<any>(
      `SELECT id, party, family, exec, cm, bill, tier, "onHold", alert, "creditLimit", "creditPeriod"
       FROM "Account"
       WHERE party ILIKE $1 OR family ILIKE $1
       ORDER BY
         CASE WHEN "onHold" = 'Active' THEN 0
              WHEN "onHold" = 'Candidate' THEN 1
              ELSE 2 END,
         bill DESC
       LIMIT 20`,
      [`%${q}%`]
    );

    return res.json({ ok: true, data: rows });
  } catch (err: any) {
    console.error('[api/hold-check] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Hold-check query failed' });
  }
}
