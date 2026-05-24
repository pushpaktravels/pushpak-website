// ============================================================
// GET  /api/users — list all users (owner only).
// PATCH /api/users — bulk-update users (owner only).
// ============================================================
// Body for PATCH:
//   updates: [
//     { id, role?, team?, active?, scoreboard?, viewPerms? }, ...
//   ]
//
// Owner can change every field. We never expose or accept
// passwordHash / totpSecret through this endpoint.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, withTransaction } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';

const Update = z.object({
  id: z.string().min(1),
  role: z.enum(['owner', 'admin', 'cm', 'exec', 'analyst']).optional(),
  team: z.array(z.string().min(1).max(60)).max(60).optional(),
  active: z.boolean().optional(),
  scoreboard: z.boolean().optional(),
  viewPerms: z.array(z.string().min(1).max(60)).max(60).optional(),
  viewReadOnly: z.array(z.string().min(1).max(60)).max(60).optional(),
});

const PatchBody = z.object({
  updates: z.array(Update).min(1).max(100),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner')) return;

  if (req.method === 'GET') {
    try {
      const rows = await query<any>(
        `SELECT id, "execId", name, role, badge, team, active, scoreboard,
                "viewPerms", "viewReadOnly", "totpEnrolledAt",
                "lastLoginAt", "createdAt"
         FROM "User"
         ORDER BY role ASC, name ASC`,
        []
      );
      return res.json({ ok: true, data: { users: rows } });
    } catch (err: any) {
      console.error('[api/users GET] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Users query failed' });
    }
  }

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });

    try {
      await withTransaction(async (q) => {
        for (const u of parsed.data.updates) {
          // Build SET clause from supplied fields only.
          const sets: string[] = [];
          const params: any[] = [];
          let p = 1;
          if (u.role         !== undefined) { sets.push(`role         = $${p++}::"Role"`); params.push(u.role); }
          if (u.team         !== undefined) { sets.push(`team         = $${p++}`);          params.push(u.team); }
          if (u.active       !== undefined) { sets.push(`active       = $${p++}`);          params.push(u.active); }
          if (u.scoreboard   !== undefined) { sets.push(`scoreboard   = $${p++}`);          params.push(u.scoreboard); }
          if (u.viewPerms    !== undefined) { sets.push(`"viewPerms"  = $${p++}`);          params.push(u.viewPerms); }
          if (u.viewReadOnly !== undefined) { sets.push(`"viewReadOnly" = $${p++}`);        params.push(u.viewReadOnly); }
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
