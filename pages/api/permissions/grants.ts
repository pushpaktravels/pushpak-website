// ============================================================
// GET   /api/permissions/grants                    — full matrix
// POST  /api/permissions/grants                    — grant / update
// DELETE /api/permissions/grants?userId=X&moduleId=Y — revoke
// All mutations are VANSHIKA01-only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requirePermissionAdmin } from '@/lib/permissions';
import { audit } from '@/lib/audit';

const Grant = z.object({
  userId:   z.string().min(1),
  moduleId: z.string().min(1),
  level:    z.enum(['view', 'edit', 'admin']),
  scope:    z.record(z.any()).optional(),
});

const Bulk = z.object({
  grants: z.array(Grant).min(1).max(500),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    // Owner-only — no one else needs to see other people's grants
    if (!requirePermissionAdmin(user, res)) return;
    const rows = await query<any>(
      `SELECT p.id, p."userId", p."moduleId", p.level, p.scope,
              p."grantedBy", p."grantedAt",
              u.name AS "userName", u."execId" AS "userExecId", u.role AS "userRole",
              m.slug AS "moduleSlug", m.name AS "moduleName",
              d.id AS "departmentId", d.slug AS "departmentSlug", d.name AS "departmentName"
         FROM "Permission" p
         JOIN "User"     u ON u.id = p."userId"
         JOIN "Module"   m ON m.id = p."moduleId"
         JOIN "Department" d ON d.id = m."departmentId"
        ORDER BY d."order", m."order", u.name`,
    );
    return res.json({ ok: true, rows });
  }

  if (!requirePermissionAdmin(user, res)) return;

  if (req.method === 'POST') {
    // Accept either { grant: {…} } single OR { grants: [...] } bulk
    const singleParsed = Grant.safeParse(req.body?.grant ?? null);
    const bulkParsed   = Bulk.safeParse(req.body);
    const list = singleParsed.success ? [singleParsed.data]
               : bulkParsed.success   ? bulkParsed.data.grants
               : null;
    if (!list) return res.status(400).json({ ok: false, error: 'Bad request' });

    let applied = 0;
    for (const g of list) {
      const u = await queryOne<any>(`SELECT id FROM "User" WHERE id = $1`, [g.userId]);
      const m = await queryOne<any>(`SELECT id FROM "Module" WHERE id = $1`, [g.moduleId]);
      if (!u || !m) continue;
      const id = newId('perm');
      await query(
        `INSERT INTO "Permission" (id, "userId", "moduleId", level, scope, "grantedBy")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("userId", "moduleId") DO UPDATE
            SET level = EXCLUDED.level,
                scope = EXCLUDED.scope,
                "grantedBy" = EXCLUDED."grantedBy",
                "grantedAt" = NOW()`,
        [id, g.userId, g.moduleId, g.level, g.scope ? JSON.stringify(g.scope) : null, user.id]
      );
      applied++;
    }
    audit(req, user, 'PERMISSION_GRANT', `${applied} grant${applied === 1 ? '' : 's'}`, { count: applied });
    return res.json({ ok: true, applied });
  }

  if (req.method === 'DELETE') {
    const userId   = String(req.query.userId   || '');
    const moduleId = String(req.query.moduleId || '');
    if (!userId || !moduleId) return res.status(400).json({ ok: false, error: 'Missing userId or moduleId' });
    const r = await query(
      `DELETE FROM "Permission" WHERE "userId" = $1 AND "moduleId" = $2`,
      [userId, moduleId]
    );
    audit(req, user, 'PERMISSION_REVOKE', `${userId}|${moduleId}`);
    return res.json({ ok: true, removed: r.length });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
