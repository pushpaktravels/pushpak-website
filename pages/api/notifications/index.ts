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
    const unread = rows.filter(r => !r.readAt).length;
    return res.json({ ok: true, rows, unread });
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
