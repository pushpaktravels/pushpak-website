// ============================================================
// GET /api/messages/users — everyone you can start a chat with.
// ============================================================
// Active users other than yourself. Used by the "New chat" picker.
// Gated on the universal 'messages' view (so the insights-only
// executive, who cannot reach chat, also cannot enumerate staff here).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'messages')) return;

  const rows = await query<any>(
    `SELECT id, "execId", name, role, badge
       FROM "User"
      WHERE active = true AND id <> $1
      ORDER BY name`,
    [user.id]
  );
  return res.json({ ok: true, users: rows });
}
