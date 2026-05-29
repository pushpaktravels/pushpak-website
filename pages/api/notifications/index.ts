// GET   /api/notifications        — latest 50 notifications for current user
// POST  /api/notifications/read   — mark id(s) as read
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const rows = await query<any>(
      `SELECT id, ts, kind, title, body, party, "accountId", "convId", "readAt"
         FROM "Notification"
        WHERE "userId" = $1
        ORDER BY ts DESC
        LIMIT 50`,
      [user.id]
    );
    // Count over ALL rows, not just the latest 50, so the badge is accurate.
    const cnt = await query<any>(
      `SELECT COUNT(*)::int AS n FROM "Notification" WHERE "userId" = $1 AND "readAt" IS NULL`,
      [user.id]
    );
    const unread = cnt[0]?.n ?? 0;
    return res.json({ ok: true, rows, unread });
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
