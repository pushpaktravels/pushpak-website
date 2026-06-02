// ============================================================
// /api/leads/[id] — update / advance / convert / delete a lead.
// ============================================================
// PATCH body: any of { stage, department, priority, assigneeExecId,
//   assigneeName, estValue, notes, lostReason, convertedType, convertedId }.
//   Moving stage→'won' with convertedType/convertedId records the seam to
//   the department record the lead became.
// DELETE — owner/admin only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const PatchBody = z.object({
  stage: z.enum(['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost']).optional(),
  department: z.string().max(60).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigneeExecId: z.string().max(60).optional().nullable(),
  assigneeName: z.string().max(120).optional().nullable(),
  estValue: z.coerce.number().min(0).max(1e9).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  lostReason: z.string().max(300).optional().nullable(),
  convertedType: z.string().max(40).optional().nullable(),
  convertedId: z.string().max(60).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'leads')) return;

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const existing = await queryOne<any>(`SELECT * FROM "Lead" WHERE id = $1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Lead not found' });

  if (req.method === 'PATCH') {
    if (!requireViewEdit(user, res, 'leads')) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
    const b = parsed.data;

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const put = (col: string, val: any) => { sets.push(`"${col}" = $${i++}`); params.push(val); };
    if (b.stage !== undefined) put('stage', b.stage);
    if (b.department !== undefined) put('department', b.department);
    if (b.priority !== undefined) put('priority', b.priority);
    if (b.assigneeExecId !== undefined) put('assigneeExecId', b.assigneeExecId);
    if (b.assigneeName !== undefined) put('assigneeName', b.assigneeName);
    if (b.estValue !== undefined) put('estValue', b.estValue);
    if (b.notes !== undefined) put('notes', b.notes);
    if (b.lostReason !== undefined) put('lostReason', b.lostReason);
    if (b.convertedType !== undefined) put('convertedType', b.convertedType);
    if (b.convertedId !== undefined) put('convertedId', b.convertedId);
    if (sets.length === 0) return res.json({ ok: true });
    put('lastActivityAt', new Date().toISOString());
    sets.push(`"updatedAt" = NOW()`);
    params.push(id);
    await query(`UPDATE "Lead" SET ${sets.join(', ')} WHERE id = $${i}`, params);
    audit(req, user, 'LEAD_UPDATE', id, { fields: Object.keys(b), stage: b.stage });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete leads' });
    }
    await query(`DELETE FROM "Lead" WHERE id = $1`, [id]);
    audit(req, user, 'LEAD_DELETE', id, { name: existing.name });
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
