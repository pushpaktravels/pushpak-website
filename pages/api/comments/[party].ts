// GET  /api/comments/[party]   — comment thread for an account
// POST /api/comments/[party]   — add a comment (body: { text })
//
// @-mentions of names that match an active user create
// Notification rows for those users.
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const party = decodeURIComponent(String(req.query.party || ''));
  if (!party) return res.status(400).json({ ok: false, error: 'Missing party' });

  if (req.method === 'GET') {
    const rows = await query<any>(
      `SELECT id, ts, "userId", "execId", "userName", body, mentions
         FROM "Comment" WHERE party = $1 ORDER BY ts ASC`,
      [party]
    );
    return res.json({ ok: true, rows });
  }

  if (req.method === 'POST') {
    const Body = z.object({ text: z.string().min(1).max(2000) });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
    const text = parsed.data.text;

    // Extract @mentions: @anil → match against User.name (case-insensitive)
    const mentionMatches = Array.from(text.matchAll(/@([a-zA-Z][a-zA-Z\s\-]{1,40})/g)).map(m => m[1].trim());
    let mentionedUsers: any[] = [];
    if (mentionMatches.length > 0) {
      mentionedUsers = await query<any>(
        `SELECT id, name FROM "User"
          WHERE active = true
            AND (UPPER(name) = ANY($1::text[]) OR UPPER(name) ILIKE ANY($2::text[]))`,
        [mentionMatches.map(m => m.toUpperCase()),
         mentionMatches.map(m => `%${m.toUpperCase()}%`)]
      );
    }

    const id = newId('cmt');
    await query(
      `INSERT INTO "Comment"
         (id, party, "userId", "execId", "userName", body, mentions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, party, user.id, user.execId, user.name, text, mentionedUsers.map(u => u.name)]
    );

    // Notifications for each @mentioned user (exclude self)
    for (const m of mentionedUsers) {
      if (m.id === user.id) continue;
      await query(
        `INSERT INTO "Notification" (id, "userId", kind, title, body, party)
         VALUES ($1, $2, 'mention', $3, $4, $5)`,
        [newId('ntf'), m.id, `${user.name} mentioned you on ${party}`, text.slice(0, 200), party]
      );
    }

    return res.json({ ok: true, id });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
