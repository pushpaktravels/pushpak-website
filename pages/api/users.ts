// ============================================================
// /api/users — owner-only roster + permission management.
// ============================================================
// GET    /api/users           — list all users
// POST   /api/users           — create new user
// PATCH  /api/users           — bulk update users
//
// PATCH body:
//   updates: [{ id, role?, team?, active?, scoreboard?, name?,
//              password?, viewPerms?, viewReadOnly? }, ...]
//
// Password (when supplied) is hashed via lib/password before
// saving. We never read or return passwordHash through this
// endpoint.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { hashPassword } from '@/lib/password';

const Update = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  role: z.enum(['owner', 'admin', 'cm', 'exec', 'analyst']).optional(),
  team: z.array(z.string().min(1).max(60)).max(60).optional(),
  active: z.boolean().optional(),
  scoreboard: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  viewPerms: z.array(z.string().min(1).max(60)).max(60).optional(),
  viewReadOnly: z.array(z.string().min(1).max(60)).max(60).optional(),
});

const PatchBody = z.object({
  updates: z.array(Update).min(1).max(100),
});

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  execId: z.string().min(1).max(40).transform(s => s.toUpperCase().trim()),
  role: z.enum(['owner', 'admin', 'cm', 'exec', 'analyst']),
  password: z.string().min(8).max(200),
  badge: z.string().max(60).optional(),
  team: z.array(z.string().min(1).max(60)).max(60).optional(),
  scoreboard: z.boolean().optional(),
  viewPerms: z.array(z.string().min(1).max(60)).max(60).optional(),
  viewReadOnly: z.array(z.string().min(1).max(60)).max(60).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner')) return;

  // ─── GET — list all users ──────────────────────────────────
  if (req.method === 'GET') {
    try {
      const rows = await query<any>(
        `SELECT id, "execId", name, role, badge, team, active, scoreboard,
                "viewPerms", "viewReadOnly", "totpEnrolledAt",
                "lastLoginAt", "createdAt"
         FROM "User"
         ORDER BY
           CASE role
             WHEN 'owner'   THEN 0
             WHEN 'admin'   THEN 1
             WHEN 'cm'      THEN 2
             WHEN 'exec'    THEN 3
             WHEN 'analyst' THEN 4
           END,
           name ASC`,
        []
      );
      return res.json({ ok: true, data: { users: rows } });
    } catch (err: any) {
      console.error('[api/users GET] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Users query failed' });
    }
  }

  // ─── POST — create new user ────────────────────────────────
  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const body = parsed.data;

    // execId must be unique
    const existing = await queryOne<any>(`SELECT id FROM "User" WHERE "execId" = $1 LIMIT 1`, [body.execId]);
    if (existing) return res.status(409).json({ ok: false, error: `Executive ID "${body.execId}" already exists` });

    const id = newId('usr');
    const passwordHash = await hashPassword(body.password);

    try {
      await query(
        `INSERT INTO "User"
          (id, "execId", name, role, "passwordHash", badge, team, scoreboard,
           active, "viewPerms", "viewReadOnly", "updatedAt")
         VALUES ($1, $2, $3, $4::"Role", $5, $6, $7, $8, true, $9, $10, NOW())`,
        [
          id, body.execId, body.name, body.role, passwordHash,
          body.badge || (body.role === 'cm' ? 'Collection Manager' : body.role === 'exec' ? 'Executive' : body.role.charAt(0).toUpperCase() + body.role.slice(1)),
          body.team || [], body.scoreboard ?? false,
          body.viewPerms || [], body.viewReadOnly || [],
        ]
      );

      audit(req, user, 'USER_CREATE', body.execId, { name: body.name, role: body.role });
      return res.json({ ok: true, id, execId: body.execId });
    } catch (err: any) {
      console.error('[api/users POST] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'User create failed' });
    }
  }

  // ─── PATCH — bulk update ───────────────────────────────────
  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });

    try {
      await withTransaction(async (q) => {
        for (const u of parsed.data.updates) {
          const sets: string[] = [];
          const params: any[] = [];
          let p = 1;
          if (u.name         !== undefined) { sets.push(`name         = $${p++}`);          params.push(u.name); }
          if (u.role         !== undefined) { sets.push(`role         = $${p++}::"Role"`); params.push(u.role); }
          if (u.team         !== undefined) { sets.push(`team         = $${p++}`);          params.push(u.team); }
          if (u.active       !== undefined) { sets.push(`active       = $${p++}`);          params.push(u.active); }
          if (u.scoreboard   !== undefined) { sets.push(`scoreboard   = $${p++}`);          params.push(u.scoreboard); }
          if (u.viewPerms    !== undefined) { sets.push(`"viewPerms"  = $${p++}`);          params.push(u.viewPerms); }
          if (u.viewReadOnly !== undefined) { sets.push(`"viewReadOnly" = $${p++}`);        params.push(u.viewReadOnly); }
          if (u.password     !== undefined) {
            const hash = await hashPassword(u.password);
            sets.push(`"passwordHash" = $${p++}`); params.push(hash);
            // Reset failed-attempt counter when password changes
            sets.push(`"failedAttempts" = 0`);
            sets.push(`"lockedUntil" = NULL`);
          }
          if (sets.length === 0) continue;
          sets.push(`"updatedAt" = NOW()`);
          params.push(u.id);
          await q(`UPDATE "User" SET ${sets.join(', ')} WHERE id = $${p}`, params);
        }
      });

      audit(req, user, 'USERS_UPDATE', null, { count: parsed.data.updates.length });

      return res.json({ ok: true, updated: parsed.data.updates.length });
    } catch (err: any) {
      console.error('[api/users PATCH] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Users update failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
