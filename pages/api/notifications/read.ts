import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

const Body = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
  const { ids, all } = parsed.data;
  if (all) {
    await query(`UPDATE "Notification" SET "readAt" = NOW() WHERE "userId" = $1 AND "readAt" IS NULL`, [user.id]);
  } else if (ids && ids.length > 0) {
    await query(`UPDATE "Notification" SET "readAt" = NOW() WHERE "userId" = $1 AND id = ANY($2::text[])`, [user.id, ids]);
  }
  return res.json({ ok: true });
}
