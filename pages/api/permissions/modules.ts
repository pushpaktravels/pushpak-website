// ============================================================
// GET   /api/permissions/modules         — list all
// POST  /api/permissions/modules         — create (VANSHIKA01)
// PATCH /api/permissions/modules         — update (VANSHIKA01)
// DELETE /api/permissions/modules?id=X   — delete (VANSHIKA01)
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { requirePermissionAdmin } from '@/lib/permissions';
import { audit } from '@/lib/audit';

const Create = z.object({
  departmentId: z.string().min(1),
  slug:         z.string().min(1).max(60).regex(/^[a-z][a-z0-9.-]*$/),
  name:         z.string().min(1).max(80),
  route:        z.string().max(200).nullable().optional(),
  description:  z.string().max(500).nullable().optional(),
  icon:         z.string().max(500).nullable().optional(),
  order:        z.number().int().optional(),
});

const Patch = z.object({
  id:           z.string().min(1),
  departmentId: z.string().min(1).optional(),
  name:         z.string().min(1).max(80).optional(),
  route:        z.string().max(200).nullable().optional(),
  description:  z.string().max(500).nullable().optional(),
  icon:         z.string().max(500).nullable().optional(),
  order:        z.number().int().optional(),
  active:       z.boolean().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'permissions')) return;

  if (req.method === 'GET') {
    const rows = await query<any>(
      `SELECT m.id, m.slug, m.name, m.route, m.description, m.icon, m."order", m.active,
              m."departmentId",
              d.slug AS "departmentSlug", d.name AS "departmentName", d.color AS "departmentColor"
         FROM "Module" m
         JOIN "Department" d ON d.id = m."departmentId"
        ORDER BY d."order", m."order", m.name`,
    );
    return res.json({ ok: true, rows });
  }

  if (!requirePermissionAdmin(user, res)) return;

  if (req.method === 'POST') {
    const parsed = Create.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const body = parsed.data;
    const dept = await queryOne<any>(`SELECT id FROM "Department" WHERE id = $1`, [body.departmentId]);
    if (!dept) return res.status(404).json({ ok: false, error: 'Department not found' });
    const dupe = await queryOne<any>(`SELECT id FROM "Module" WHERE slug = $1`, [body.slug]);
    if (dupe)  return res.status(409).json({ ok: false, error: 'A module with that slug already exists.' });
    const id = newId('mod');
    await query(
      `INSERT INTO "Module"
         (id, "departmentId", slug, name, route, description, icon, "order")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, body.departmentId, body.slug, body.name, body.route ?? null,
       body.description ?? null, body.icon ?? null, body.order ?? 0]
    );
    audit(req, user, 'MODULE_CREATE', body.slug, { name: body.name, departmentId: body.departmentId });
    return res.json({ ok: true, id });
  }

  if (req.method === 'PATCH') {
    const parsed = Patch.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const body = parsed.data;
    const sets: string[] = []; const params: any[] = []; let i = 1;
    if (body.departmentId !== undefined) { sets.push(`"departmentId" = $${i++}`); params.push(body.departmentId); }
    if (body.name         !== undefined) { sets.push(`name           = $${i++}`); params.push(body.name); }
    if (body.route        !== undefined) { sets.push(`route          = $${i++}`); params.push(body.route); }
    if (body.description  !== undefined) { sets.push(`description    = $${i++}`); params.push(body.description); }
    if (body.icon         !== undefined) { sets.push(`icon           = $${i++}`); params.push(body.icon); }
    if (body.order        !== undefined) { sets.push(`"order"        = $${i++}`); params.push(body.order); }
    if (body.active       !== undefined) { sets.push(`active         = $${i++}`); params.push(body.active); }
    if (sets.length === 0) return res.json({ ok: true, changed: 0 });
    sets.push(`"updatedAt" = NOW()`);
    params.push(body.id);
    await query(`UPDATE "Module" SET ${sets.join(', ')} WHERE id = $${i}`, params);
    audit(req, user, 'MODULE_UPDATE', body.id, body);
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
    await query(`DELETE FROM "Module" WHERE id = $1`, [id]);
    audit(req, user, 'MODULE_DELETE', id);
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
