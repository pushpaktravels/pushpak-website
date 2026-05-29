// POST /api/whatsapp/log — record that a WhatsApp message was sent
// for a party. Writes an AccountHistory row + audit entry. Called
// by the drawer / worklist button right after window.open(wa.me…).
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, query, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { audit } from '@/lib/audit';

const Body = z.object({
  party:    z.string().min(1).max(200),
  template: z.string().max(40).optional(),
  to:       z.string().max(40).optional(),
  message:  z.string().max(3000).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'worklist')) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
  const { party, template, to, message } = parsed.data;

  const acct = await queryOne<any>(`SELECT exec, cm, bill FROM "Account" WHERE party = $1 LIMIT 1`, [party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const id = newId('hist');
  await query(
    `INSERT INTO "AccountHistory"
       (id, ts, party, exec, cm, action, "newValue", outstanding, source)
     VALUES ($1, NOW(), $2, $3, $4, 'WhatsApp message logged', $5, $6, 'Portal')`,
    [id, party, user.name, acct.cm,
     `${template || 'custom'}${to ? ` → ${to}` : ''}`,
     acct.bill]
  );
  // Also bump lastTouched + recentCall so the worklist's "stale" view
  // picks up the WhatsApp send as activity.
  await query(
    `UPDATE "Account" SET "recentCall" = NOW(), "lastTouched" = NOW(), "updatedAt" = NOW()
       WHERE party = $1`,
    [party]
  );

  audit(req, user, 'WA_SEND', party, { template, to, preview: (message || '').slice(0, 100) });
  return res.json({ ok: true });
}
