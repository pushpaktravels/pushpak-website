// ============================================================
// GET   /api/permissions/departments        — list all
// POST  /api/permissions/departments        — create (VANSHIKA01)
// PATCH /api/permissions/departments        — update (VANSHIKA01)
// DELETE /api/permissions/departments?id=X  — delete (VANSHIKA01)
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requirePermissionAdmin } from '@/lib/permissions';
import { audit } from '@/lib/audit';

const Create = z.object({
  slug:  z.string().min(1).max(40).regex(/^[a-z][a-z0-9-]*$/),
  name:  z.string().min(1).max(80),
  color: z.string().max(20).optional(),
  icon:  z.string().max(200).optional(),
  order: z.number().int().optional(),
});

const Patch = z.object({
  id:     z.string().min(1),
  name:   z.string().min(1).max(80).optional(),
  color:  z.string().max(20).nullable().optional(),
  icon:   z.string().max(200).nullable().optional(),
  order:  z.number().int().optional(),
  active: z.boolean().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const rows = await query<any>(
      `SELECT id, slug, name, color, icon, "order", active,
              (SELECT COUNT(*)::int FROM "Module" m WHERE m."departmentId" = d.id) AS "moduleCount"
         FROM "Department" d
        ORDER BY "order", name`,
    );
    return res.json({ ok: true, rows });
  }

  // Mutation routes are VANSHIKA01-only
  if (!requirePermissionAdmin(user, res)) return;

  if (req.method === 'POST') {
    const parsed = Create.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const { slug, name, color, icon, order } = parsed.data;
    const existing = await queryOne<any>(`SELECT id FROM "Department" WHERE slug = $1`, [slug]);
    if (existing) return res.status(409).json({ ok: false, error: 'A department with that slug already exists.' });
    const id = newId('dept');
    await query(
      `INSERT INTO "Department" (id, slug, name, color, icon, "order") VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, slug, name, color ?? null, icon ?? null, order ?? 0]
    );
    audit(req, user, 'DEPARTMENT_CREATE', slug, { name });
    return res.json({ ok: true, id });
  }

  if (req.method === 'PATCH') {
    const parsed = Patch.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const body = parsed.data;
    const sets: string[] = []; const params: any[] = []; let i = 1;
    if (body.name   !== undefined) { sets.push(`name   = $${i++}`); params.push(body.name); }
    if (body.color  !== undefined) { sets.push(`color  = $${i++}`); params.push(body.color); }
    if (body.icon   !== undefined) { sets.push(`icon   = $${i++}`); params.push(body.icon); }
    if (body.order  !== undefined) { sets.push(`"order" = $${i++}`); params.push(body.order); }
    if (body.active !== undefined) { sets.push(`active = $${i++}`); params.push(body.active); }
    if (sets.length === 0) return res.json({ ok: true, changed: 0 });
    sets.push(`"updatedAt" = NOW()`);
    params.push(body.id);
    await query(`UPDATE "Department" SET ${sets.join(', ')} WHERE id = $${i}`, params);
    audit(req, user, 'DEPARTMENT_UPDATE', body.id, body);
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
    await query(`DELETE FROM "Department" WHERE id = $1`, [id]);
    audit(req, user, 'DEPARTMENT_DELETE', id);
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
