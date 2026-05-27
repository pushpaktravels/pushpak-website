// ============================================================
// GET /api/upload/history — recent RefreshLog rows for the Upload page.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, requireRole } from '@/lib/auth';
import { query } from '@/lib/pg';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  const rows = await query<any>(
    `SELECT id, ts, "byWhom", "accountCount", "totalOutstanding"::float8 AS "totalOutstanding",
            delta::float8 AS delta, "promisesKept", "promisesBroken",
            "newHoldCandidates", "newCollections", notes
       FROM "RefreshLog"
      ORDER BY ts DESC
      LIMIT 20`
  );
  return res.json({ ok: true, refreshes: rows });
}
