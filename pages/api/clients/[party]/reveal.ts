// ============================================================
// POST /api/clients/[party]/reveal — unmask a single PII field
// after writing an audit-log entry.
// ============================================================
// Body: { field: 'phone1' | 'phone2' | 'whatsapp' | 'email' | 'address' }
// Response: { ok: true, value: '<full unmasked value>' }
//
// Every successful reveal writes an AuditLog row with
// action='PII_REVEAL' so the owner can review later who saw what.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { audit } from '@/lib/audit';

const Body = z.object({
  field: z.enum(['phone1', 'phone2', 'whatsapp', 'email', 'address']),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const party = decodeURIComponent(String(req.query.party || ''));
  if (!party) return res.status(400).json({ ok: false, error: 'Missing party' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
  const { field } = parsed.data;

  const client = await queryOne<any>(`SELECT * FROM "ClientMaster" WHERE party = $1 LIMIT 1`, [party]);
  if (!client) return res.status(404).json({ ok: false, error: 'Client master row not found' });

  const value = client[field] ?? null;
  audit(req, user, 'PII_REVEAL', party, { field });
  return res.json({ ok: true, value });
}
