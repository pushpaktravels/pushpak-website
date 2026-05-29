// ============================================================
// GET /api/messages/admin — OWNER-ONLY chat oversight.
// ============================================================
// Lets the owner (VANSHIKA01) read every conversation in the portal.
// Deliberately SEPARATE from /api/messages/* so observing leaves no
// trace: it never inserts a participant row, never moves anyone's
// lastReadAt, and never writes a notification. Execs therefore cannot
// tell their chats are being read.
//
// Gated on the 'owner' role via requireRole — admins (e.g. Dulu, Reeta)
// and the insights-only executive (Vishal) are refused at the API layer,
// and this view is intentionally NOT registered in lib/views.ts, so it
// never appears in the Users & Authorities access matrix.
//
//   GET                     → every conversation (members + last activity)
//   GET ?conversationId=ID  → the full transcript of one conversation
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner')) return;

  const conversationId = req.query.conversationId ? String(req.query.conversationId) : null;

  if (conversationId) {
    const members = await query<any>(
      `SELECT u.id, u."execId", u.name, u.role
         FROM "ConversationParticipant" cp
         JOIN "User" u ON u.id = cp."userId"
        WHERE cp."conversationId" = $1`,
      [conversationId]
    );
    const messages = await query<any>(
      `SELECT m.id, m."senderId", u.name AS "senderName", u."execId" AS "senderExecId",
              m.body, m."createdAt"
         FROM "Message" m
         JOIN "User" u ON u.id = m."senderId"
        WHERE m."conversationId" = $1
        ORDER BY m."createdAt" ASC`,
      [conversationId]
    );
    return res.json({ ok: true, members, messages });
  }

  // All conversations, newest activity first, with members + counts.
  const convs = await query<any>(
    `SELECT c.id, c."isGroup", c.title, c."createdAt", c."lastMessageAt",
            (SELECT COUNT(*)::int FROM "Message" m WHERE m."conversationId" = c.id) AS "messageCount"
       FROM "Conversation" c
      ORDER BY c."lastMessageAt" DESC
      LIMIT 500`
  );
  if (convs.length === 0) return res.json({ ok: true, conversations: [] });

  const ids = convs.map(c => c.id);
  const members = await query<any>(
    `SELECT cp."conversationId", u.id, u."execId", u.name
       FROM "ConversationParticipant" cp
       JOIN "User" u ON u.id = cp."userId"
      WHERE cp."conversationId" = ANY($1::text[])`,
    [ids]
  );
  const lastMsgs = await query<any>(
    `SELECT DISTINCT ON ("conversationId") "conversationId", body
       FROM "Message"
      WHERE "conversationId" = ANY($1::text[])
      ORDER BY "conversationId", "createdAt" DESC`,
    [ids]
  );
  const membersByConv = new Map<string, any[]>();
  for (const m of members) {
    if (!membersByConv.has(m.conversationId)) membersByConv.set(m.conversationId, []);
    membersByConv.get(m.conversationId)!.push({ id: m.id, execId: m.execId, name: m.name });
  }
  const lastByConv = new Map(lastMsgs.map(m => [m.conversationId, m.body]));

  const conversations = convs.map(c => {
    const mem = membersByConv.get(c.id) || [];
    const title = c.isGroup ? (c.title || mem.map(m => m.name).join(', ') || 'Group') : mem.map(m => m.name).join(' ↔ ');
    const lastBody = lastByConv.get(c.id);
    return {
      id: c.id,
      isGroup: c.isGroup,
      title,
      members: mem,
      messageCount: c.messageCount,
      lastMessageAt: c.lastMessageAt,
      preview: lastBody ? String(lastBody).slice(0, 100) : null,
    };
  });
  return res.json({ ok: true, conversations });
}
