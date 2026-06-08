// ============================================================
// /api/queries/forms/[id] — edit / remove a query-form (owner only).
// ============================================================
//   PATCH  → update title / fields / fillRoles / fillDepts / viewRoles /
//            defaultClassify / active. The owner reshapes the form here.
//   DELETE → remove the form definition (does not delete past submissions).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

const FieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'textarea', 'number', 'money', 'date', 'select', 'account', 'file']),
  required: z.boolean().optional(),
  options: z.array(z.string().max(80)).max(40).optional(),
  help: z.string().max(200).optional(),
});

const PatchBody = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  fields: z.array(FieldSchema).max(40).optional(),
  fillRoles: z.array(z.string().max(40)).max(30).optional(),
  fillDepts: z.array(z.string().max(40)).max(30).optional(),
  viewRoles: z.array(z.string().max(40)).max(30).optional(),
  defaultClassify: z.enum(['supplier', 'client', 'card', 'payment']).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'queries')) return;
  if (user.role !== 'owner') return res.status(403).json({ ok: false, error: 'Owner only' });

  const id = String(req.query.id || '');
  const form = await queryOne<any>(`SELECT * FROM "QueryForm" WHERE id = $1`, [id]);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });

  if (req.method === 'DELETE') {
    await query(`DELETE FROM "QueryForm" WHERE id = $1`, [id]);
    return res.json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const b = parsed.data;

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const put = (col: string, val: any, cast = '') => { sets.push(`"${col}" = $${i}${cast}`); params.push(val); i++; };

    if (b.title !== undefined) put('title', b.title);
    if (b.description !== undefined) put('description', b.description || null);
    if (b.fields !== undefined) put('fields', JSON.stringify(b.fields), '::jsonb');
    if (b.fillRoles !== undefined) put('fillRoles', b.fillRoles);
    if (b.fillDepts !== undefined) put('fillDepts', b.fillDepts);
    if (b.viewRoles !== undefined) put('viewRoles', b.viewRoles);
    if (b.defaultClassify !== undefined) put('defaultClassify', b.defaultClassify || null);
    if (b.active !== undefined) put('active', b.active);
    if (b.sortOrder !== undefined) put('sortOrder', b.sortOrder);

    if (!sets.length) return res.status(400).json({ ok: false, error: 'Nothing to update' });
    sets.push(`"updatedAt" = NOW()`);
    params.push(id);
    await query(`UPDATE "QueryForm" SET ${sets.join(', ')} WHERE id = $${i}`, params);
    const row = await queryOne<any>(`SELECT * FROM "QueryForm" WHERE id = $1`, [id]);
    return res.json({ ok: true, form: row });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
