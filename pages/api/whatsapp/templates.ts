// GET /api/whatsapp/templates — returns the 5 WhatsApp reminder
// templates from Setting rows so the drawer can list them in the
// Send Reminder picker.
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

const TEMPLATES = [
  { key: 'WA_TPL_GENTLE',           label: 'Gentle reminder',  tone: 'sage'  as const },
  { key: 'WA_TPL_FIRM',             label: 'Firm reminder',    tone: 'amber' as const },
  { key: 'WA_TPL_LEGAL',            label: 'Legal warning',    tone: 'rust'  as const },
  { key: 'WA_TPL_PROMISE_BROKEN',   label: 'Promise broken',   tone: 'amber' as const },
  { key: 'WA_TPL_PAYMENT_RECEIVED', label: 'Payment received', tone: 'sage'  as const },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const rows = await query<any>(
    `SELECT key, value FROM "Setting" WHERE key = ANY($1::text[])`,
    [TEMPLATES.map(t => t.key)]
  );
  const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return res.json({
    ok: true,
    templates: TEMPLATES.map(t => ({ ...t, body: byKey[t.key] || '' })),
  });
}
