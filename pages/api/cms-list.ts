// ============================================================
// GET /api/cms-list — names of all active CMs (and owners/admins
// who can also be assigned to act as a CM for some accounts).
// ============================================================
// Used by the Bulk CM page dropdown + by any future "assign CM"
// inline UI on the drawer. Lighter than /api/users which is owner-
// only and returns the full roster + permission grid.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const rows = await query<any>(
      `SELECT name, role
         FROM "User"
        WHERE active = true
          AND role IN ('owner','admin','cm-accounts')
        ORDER BY
          CASE role WHEN 'cm-accounts' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
          name`
    );
    return res.json({ ok: true, cms: rows });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed' });
  }
}
