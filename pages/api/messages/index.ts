// ============================================================
// /api/messages
//   GET  — conversations I'm in (with preview + unread + members)
//   POST — start (or reuse) a conversation: { userIds[], title? }
// ============================================================
// 1-to-1 chats are de-duplicated by dmKey (the two userIds sorted),
// so "message Reeta" always reopens the same thread. Groups (2+ other
// people) always create a fresh thread.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, withTransaction, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

const CreateBody = z.object({
  userIds: z.array(z.string()).min(1),
  title: z.string().trim().max(120).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'messages')) return;

  if (req.method === 'GET') return list(user, res);
  if (req.method === 'POST') return create(user, req, res);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(user: any, res: NextApiResponse) {
  const convs = await query<any>(
    `SELECT c.id, c."isGroup", c.title, c."lastMessageAt", p."lastReadAt"
       FROM "Conversation" c
       JOIN "ConversationParticipant" p
         ON p."conversationId" = c.id AND p."userId" = $1
      ORDER BY c."lastMessageAt" DESC
      LIMIT 200`,
    [user.id]
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
    `SELECT DISTINCT ON ("conversationId")
            "conversationId", body, "senderId", "createdAt"
       FROM "Message"
      WHERE "conversationId" = ANY($1::text[])
      ORDER BY "conversationId", "createdAt" DESC`,
    [ids]
  );
  const unread = await query<any>(
    `SELECT m."conversationId", COUNT(*)::int AS n
       FROM "Message" m
       JOIN "ConversationParticipant" p
         ON p."conversationId" = m."conversationId" AND p."userId" = $1
      WHERE m."conversationId" = ANY($2::text[])
        AND m."senderId" <> $1
        AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
      GROUP BY m."conversationId"`,
    [user.id, ids]
  );

  const membersByConv = new Map<string, any[]>();
  for (const m of members) {
    if (!membersByConv.has(m.conversationId)) membersByConv.set(m.conversationId, []);
    membersByConv.get(m.conversationId)!.push({ id: m.id, execId: m.execId, name: m.name });
  }
  const lastByConv = new Map(lastMsgs.map(m => [m.conversationId, m]));
  const unreadByConv = new Map(unread.map(u => [u.conversationId, u.n]));

  const conversations = convs.map(c => {
    const mem = membersByConv.get(c.id) || [];
    const others = mem.filter(m => m.id !== user.id);
    const title = c.isGroup
      ? (c.title || others.map(o => o.name).join(', ') || 'Group')
      : (others[0]?.name || 'Unknown');
    const last = lastByConv.get(c.id);
    return {
      id: c.id,
      isGroup: c.isGroup,
      title,
      members: mem,
      lastMessageAt: c.lastMessageAt,
      preview: last ? String(last.body).slice(0, 80) : null,
      unread: unreadByConv.get(c.id) || 0,
    };
  });
  return res.json({ ok: true, conversations });
}

async function create(user: any, req: NextApiRequest, res: NextApiResponse) {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });

  // Resolve + validate the requested people (active users, not me).
  const requested = Array.from(new Set(parsed.data.userIds.filter(id => id !== user.id)));
  if (requested.length === 0) return res.status(400).json({ ok: false, error: 'Pick at least one other person' });

  const valid = await query<any>(
    `SELECT id FROM "User" WHERE active = true AND id = ANY($1::text[])`,
    [requested]
  );
  const otherIds = valid.map(v => v.id);
  if (otherIds.length === 0) return res.status(400).json({ ok: false, error: 'No valid recipients' });

  const allIds = Array.from(new Set([user.id, ...otherIds]));
  const isGroup = allIds.length > 2;
  const dmKey = isGroup ? null : [...allIds].sort().join(':');

  const conversationId = await withTransaction(async (q) => {
    if (dmKey) {
      const existing = await q(`SELECT id FROM "Conversation" WHERE "dmKey" = $1`, [dmKey]);
      if (existing[0]) return existing[0].id as string;
    }
    const convId = newId('conv');
    // Atomic upsert: if two requests race to open the same 1-to-1 thread,
    // the unique dmKey makes the loser get no row back — reuse the winner's.
    const inserted = await q(
      `INSERT INTO "Conversation" (id, "isGroup", title, "dmKey", "createdBy", "createdAt", "lastMessageAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT ("dmKey") DO NOTHING
       RETURNING id`,
      [convId, isGroup, isGroup ? (parsed.data.title || null) : null, dmKey, user.id]
    );
    if (inserted.length === 0) {
      const row = await q(`SELECT id FROM "Conversation" WHERE "dmKey" = $1`, [dmKey]);
      return row[0].id as string;
    }
    for (const uid of allIds) {
      await q(
        `INSERT INTO "ConversationParticipant" (id, "conversationId", "userId", "lastReadAt", "addedAt")
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT ("conversationId", "userId") DO NOTHING`,
        [newId('cp'), convId, uid, uid === user.id ? new Date() : null]
      );
    }
    return convId;
  });

  return res.json({ ok: true, conversationId });
}
