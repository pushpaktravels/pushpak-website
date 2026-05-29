// ============================================================
// /api/messages/[conversationId]
//   GET  — full thread (only if I'm a participant); marks it read
//   POST — send a message: { body }; notifies the other participants
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

const SendBody = z.object({ body: z.string().trim().min(1).max(4000) });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'messages')) return;

  const conversationId = String(req.query.conversationId || '');
  if (!conversationId) return res.status(400).json({ ok: false, error: 'Missing conversation' });

  // Membership check — you can only touch a thread you belong to. (The
  // owner's read-everything view lives at /api/messages/admin instead, so
  // that path never updates read state or creates notifications here.)
  const me = await queryOne<any>(
    `SELECT id FROM "ConversationParticipant" WHERE "conversationId" = $1 AND "userId" = $2`,
    [conversationId, user.id]
  );
  if (!me) return res.status(403).json({ ok: false, error: 'Not your conversation' });

  if (req.method === 'GET') return read(user, conversationId, res);
  if (req.method === 'POST') return send(user, conversationId, req, res);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function read(user: any, conversationId: string, res: NextApiResponse) {
  const conv = await queryOne<any>(
    `SELECT id, "isGroup", title FROM "Conversation" WHERE id = $1`,
    [conversationId]
  );
  const members = await query<any>(
    `SELECT u.id, u."execId", u.name
       FROM "ConversationParticipant" cp
       JOIN "User" u ON u.id = cp."userId"
      WHERE cp."conversationId" = $1`,
    [conversationId]
  );
  const messages = await query<any>(
    `SELECT m.id, m."senderId", u.name AS "senderName", m.body, m."createdAt"
       FROM "Message" m
       JOIN "User" u ON u.id = m."senderId"
      WHERE m."conversationId" = $1
      ORDER BY m."createdAt" ASC
      LIMIT 500`,
    [conversationId]
  );

  // Mark read for ME only: move my cursor + clear my message notifications
  // for this thread so the bell badge clears.
  await query(
    `UPDATE "ConversationParticipant" SET "lastReadAt" = NOW() WHERE "conversationId" = $1 AND "userId" = $2`,
    [conversationId, user.id]
  );
  await query(
    `UPDATE "Notification" SET "readAt" = NOW()
      WHERE "userId" = $1 AND kind = 'MESSAGE' AND "convId" = $2 AND "readAt" IS NULL`,
    [user.id, conversationId]
  );

  const others = members.filter(m => m.id !== user.id);
  const title = conv?.isGroup
    ? (conv.title || others.map(o => o.name).join(', ') || 'Group')
    : (others[0]?.name || 'Unknown');

  return res.json({
    ok: true,
    conversation: { id: conversationId, isGroup: !!conv?.isGroup, title, members },
    messages,
  });
}

async function send(user: any, conversationId: string, req: NextApiRequest, res: NextApiResponse) {
  const parsed = SendBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Message is empty or too long' });
  const body = parsed.data.body;

  const msgId = newId('msg');
  await query(
    `INSERT INTO "Message" (id, "conversationId", "senderId", body, "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [msgId, conversationId, user.id, body]
  );
  await query(`UPDATE "Conversation" SET "lastMessageAt" = NOW() WHERE id = $1`, [conversationId]);
  await query(
    `UPDATE "ConversationParticipant" SET "lastReadAt" = NOW() WHERE "conversationId" = $1 AND "userId" = $2`,
    [conversationId, user.id]
  );

  // Notify the OTHER participants (bell badge). Group → include the thread
  // title so they know where it landed.
  const conv = await queryOne<any>(`SELECT "isGroup", title FROM "Conversation" WHERE id = $1`, [conversationId]);
  const others = await query<any>(
    `SELECT "userId" FROM "ConversationParticipant" WHERE "conversationId" = $1 AND "userId" <> $2`,
    [conversationId, user.id]
  );
  const where = conv?.isGroup ? ` in ${conv.title || 'a group'}` : '';
  const title = `New message from ${user.name}${where}`;
  const preview = body.slice(0, 140);
  for (const o of others) {
    await query(
      `INSERT INTO "Notification" (id, ts, "userId", kind, title, body, "convId")
       VALUES ($1, NOW(), $2, 'MESSAGE', $3, $4, $5)`,
      [newId('ntf'), o.userId, title, preview, conversationId]
    );
  }

  return res.json({ ok: true, id: msgId });
}
