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
import { validatePassword, getSecurityPolicy } from '@/lib/policy';
import { ROLE_SLUGS, roleBadge } from '@/lib/roles';

const RoleEnum = z.enum(ROLE_SLUGS as [string, ...string[]]);

const Update = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  role: RoleEnum.optional(),
  team: z.array(z.string().min(1).max(60)).max(60).optional(),
  active: z.boolean().optional(),
  scoreboard: z.boolean().optional(),
  // min(1) here, not min(8): the real strength check is the live
  // policy in lib/policy.ts, applied below before hashing.
  password: z.string().min(1).max(200).optional(),
  email: z.string().email().max(120).nullable().optional(),
  viewPerms: z.array(z.string().min(1).max(60)).max(60).optional(),
  viewReadOnly: z.array(z.string().min(1).max(60)).max(60).optional(),
  // Per-user form-fill override (QueryForm.key slugs). Empty = inherit role default.
  formPerms: z.array(z.string().min(1).max(60)).max(60).optional(),
  // ── Per-user account security ──
  mfaRequired: z.boolean().optional(),         // mandate 2FA for this user
  mustChangePassword: z.boolean().optional(),  // force a change at next sign-in
  unlock: z.boolean().optional(),              // clear failed-attempt lockout
  resetMfa: z.boolean().optional(),            // wipe their TOTP enrollment
});

const PatchBody = z.object({
  updates: z.array(Update).min(1).max(100),
});

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  execId: z.string().min(1).max(40).transform(s => s.toUpperCase().trim()),
  role: RoleEnum,
  password: z.string().min(1).max(200), // strength enforced by live policy below
  badge: z.string().max(60).optional(),
  team: z.array(z.string().min(1).max(60)).max(60).optional(),
  scoreboard: z.boolean().optional(),
  viewPerms: z.array(z.string().min(1).max(60)).max(60).optional(),
  viewReadOnly: z.array(z.string().min(1).max(60)).max(60).optional(),
  formPerms: z.array(z.string().min(1).max(60)).max(60).optional(),
  mfaRequired: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner')) return;

  // ─── GET — list all users ──────────────────────────────────
  if (req.method === 'GET') {
    try {
      const rows = await query<any>(
        `SELECT id, "execId", name, role, badge, team, active, scoreboard, email,
                "viewPerms", "viewReadOnly", "formPerms", "totpEnrolledAt", "mfaRequired",
                "failedAttempts", "lockedUntil", "mustChangePassword",
                "passwordChangedAt", "lastLoginAt", "lastLoginIp", "createdAt"
         FROM "User"
         ORDER BY
           CASE role
             WHEN 'owner'                  THEN 0
             WHEN 'admin'                  THEN 1
             WHEN 'cm-accounts'            THEN 2
             WHEN 'accounts'               THEN 3
             WHEN 'domestic-reservations'  THEN 4
             WHEN 'domestic-package'       THEN 5
             WHEN 'international-packages' THEN 6
             WHEN 'visa'                   THEN 7
             WHEN 'insights'               THEN 8
             WHEN 'marketing'              THEN 9
             WHEN 'hr'                     THEN 10
             ELSE 99
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

    // Enforce the live password policy on the initial password.
    const pwErr = await validatePassword(body.password);
    if (pwErr) return res.status(400).json({ ok: false, error: pwErr });

    // execId must be unique
    const existing = await queryOne<any>(`SELECT id FROM "User" WHERE "execId" = $1 LIMIT 1`, [body.execId]);
    if (existing) return res.status(409).json({ ok: false, error: `Executive ID "${body.execId}" already exists` });

    const id = newId('usr');
    const passwordHash = await hashPassword(body.password);

    try {
      await query(
        `INSERT INTO "User"
          (id, "execId", name, role, "passwordHash", badge, team, scoreboard,
           active, "viewPerms", "viewReadOnly", "formPerms", "mfaRequired", "mustChangePassword",
           "passwordChangedAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13, NOW(), NOW())`,
        [
          id, body.execId, body.name, body.role, passwordHash,
          body.badge || roleBadge(body.role),
          body.team || [], body.scoreboard ?? false,
          body.viewPerms || [], body.viewReadOnly || [], body.formPerms || [],
          body.mfaRequired ?? false, body.mustChangePassword ?? false,
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

    // Enforce the live password policy on every supplied password
    // BEFORE opening a transaction or hashing anything.
    const policy = await getSecurityPolicy();
    for (const u of parsed.data.updates) {
      if (u.password !== undefined) {
        const pwErr = await validatePassword(u.password, policy);
        if (pwErr) return res.status(400).json({ ok: false, error: pwErr });
      }
    }

    // Resolve execIds for clean audit targets in one round-trip.
    const idRows = await query<any>(
      `SELECT id, "execId" FROM "User" WHERE id = ANY($1)`,
      [parsed.data.updates.map(u => u.id)]
    );
    const execById = new Map<string, string>(idRows.map((r: any) => [r.id, r.execId]));
    const securityEvents: { execId: string; action: string }[] = [];

    try {
      await withTransaction(async (q) => {
        for (const u of parsed.data.updates) {
          const sets: string[] = [];
          const params: any[] = [];
          let p = 1;
          const ev = (action: string) => securityEvents.push({ execId: execById.get(u.id) || u.id, action });

          if (u.name         !== undefined) { sets.push(`name           = $${p++}`); params.push(u.name); }
          if (u.role         !== undefined) { sets.push(`role           = $${p++}`); params.push(u.role); }
          if (u.team         !== undefined) { sets.push(`team           = $${p++}`); params.push(u.team); }
          if (u.active       !== undefined) { sets.push(`active         = $${p++}`); params.push(u.active); }
          if (u.scoreboard   !== undefined) { sets.push(`scoreboard     = $${p++}`); params.push(u.scoreboard); }
          if (u.viewPerms    !== undefined) { sets.push(`"viewPerms"    = $${p++}`); params.push(u.viewPerms); }
          if (u.viewReadOnly !== undefined) { sets.push(`"viewReadOnly" = $${p++}`); params.push(u.viewReadOnly); }
          if (u.formPerms    !== undefined) { sets.push(`"formPerms"    = $${p++}`); params.push(u.formPerms); }
          if (u.email        !== undefined) { sets.push(`email          = $${p++}`); params.push(u.email); }
          if (u.mfaRequired  !== undefined) { sets.push(`"mfaRequired"  = $${p++}`); params.push(u.mfaRequired); ev(u.mfaRequired ? 'MFA_REQUIRED_ON' : 'MFA_REQUIRED_OFF'); }

          // Reset 2FA enrollment — they'll re-enroll on next sign-in.
          if (u.resetMfa === true) {
            sets.push(`"totpSecret" = NULL`);
            sets.push(`"totpEnrolledAt" = NULL`);
            ev('MFA_RESET');
          }

          const pwChange = u.password !== undefined;
          if (pwChange) {
            const hash = await hashPassword(u.password!);
            sets.push(`"passwordHash" = $${p++}`); params.push(hash);
            sets.push(`"passwordChangedAt" = NOW()`);
            ev('PASSWORD_RESET');
          }

          // failedAttempts / lockedUntil are cleared by an explicit
          // unlock OR by a password reset (assigned once, no dupes).
          if (u.unlock === true || pwChange) {
            sets.push(`"failedAttempts" = 0`);
            sets.push(`"lockedUntil" = NULL`);
            if (u.unlock === true && !pwChange) ev('ACCOUNT_UNLOCK');
          }

          // mustChangePassword: a password reset satisfies/clears it;
          // otherwise honour the explicit flag (assigned once).
          if (pwChange) {
            sets.push(`"mustChangePassword" = false`);
          } else if (u.mustChangePassword !== undefined) {
            sets.push(`"mustChangePassword" = $${p++}`); params.push(u.mustChangePassword);
            if (u.mustChangePassword) ev('FORCE_PASSWORD_CHANGE');
          }

          if (sets.length === 0) continue;
          sets.push(`"updatedAt" = NOW()`);
          params.push(u.id);
          await q(`UPDATE "User" SET ${sets.join(', ')} WHERE id = $${p}`, params);
        }
      });

      audit(req, user, 'USERS_UPDATE', null, { count: parsed.data.updates.length });
      // A discrete audit row per security-sensitive action so the
      // Audit Log reads cleanly (e.g. "PASSWORD_RESET → RAUNAK01").
      for (const ev of securityEvents) audit(req, user, ev.action, ev.execId);

      return res.json({ ok: true, updated: parsed.data.updates.length });
    } catch (err: any) {
      console.error('[api/users PATCH] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Users update failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
