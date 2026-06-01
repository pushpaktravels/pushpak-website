// ============================================================
// GET /api/messages/unread — total unread chat messages for me.
// ============================================================
// Lightweight aggregate used by the sidebar "Messages" badge so an
// executive sees a count without opening the chat. Counts messages in
// my conversations that I didn't send and that arrived after my
// lastReadAt for that conversation. Mirrors the per-conversation logic
// in /api/messages (GET) but rolls it up to one number.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'messages')) return;

  try {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM "Message" m
         JOIN "ConversationParticipant" p
           ON p."conversationId" = m."conversationId" AND p."userId" = $1
        WHERE m."senderId" <> $1
          AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")`,
      [user.id]
    );
    return res.json({ ok: true, unread: row?.n || 0 });
  } catch (err: any) {
    console.error('[api/messages/unread] error', err);
    return res.status(500).json({ ok: false, error: 'Unread count failed' });
  }
}
