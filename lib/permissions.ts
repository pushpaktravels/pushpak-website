// ============================================================
// lib/permissions.ts — server-side permission helpers.
// ============================================================
// Two distinct concepts:
//
// 1. requirePermissionAdmin(user, res)
//      Hard-locked to a specific exec ID. Per owner directive, only
//      VANSHIKA01 can manage Departments / Modules / Permissions —
//      not even other 'owner' role users. Returns true if allowed,
//      otherwise sends 403 and returns false.
//
// 2. requirePermission(user, moduleSlug, minLevel)
//      Used by feature endpoints to gate access. Checks the
//      Permission table for the (user, module) row and enforces the
//      requested minimum level (view < edit < admin). Returns true
//      if allowed, otherwise sends 403.
//
// requirePermission is an OPT-IN replacement for requireRole. The
// existing role-gated endpoints keep working unchanged; new endpoints
// can use this instead.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthedUser } from './auth';
import { queryOne } from './pg';

export const PERMISSION_ADMIN_EXEC_ID = 'VANSHIKA01';

export function isPermissionAdmin(user: AuthedUser): boolean {
  return user.execId === PERMISSION_ADMIN_EXEC_ID;
}

export function requirePermissionAdmin(
  user: AuthedUser,
  res: NextApiResponse,
): boolean {
  if (!isPermissionAdmin(user)) {
    res.status(403).json({
      ok: false,
      error: 'Permission management is restricted to the system owner.',
    });
    return false;
  }
  return true;
}

const LEVEL_RANK: Record<string, number> = { none: 0, view: 1, edit: 2, admin: 3 };
export type PermissionLevel = 'view' | 'edit' | 'admin';

export async function getEffectiveLevel(
  userId: string,
  moduleSlug: string,
): Promise<PermissionLevel | 'none'> {
  const row = await queryOne<any>(
    `SELECT p.level
       FROM "Permission" p
       JOIN "Module" m ON m.id = p."moduleId"
      WHERE p."userId" = $1 AND m.slug = $2
      LIMIT 1`,
    [userId, moduleSlug],
  );
  return row?.level ?? 'none';
}

export async function requirePermission(
  user: AuthedUser,
  res: NextApiResponse,
  moduleSlug: string,
  minLevel: PermissionLevel,
): Promise<boolean> {
  // VANSHIKA01 always has full access to everything — she's the
  // root of trust and her permissions can't be revoked by accident.
  if (isPermissionAdmin(user)) return true;
  const level = await getEffectiveLevel(user.id, moduleSlug);
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
    res.status(403).json({
      ok: false,
      error: `Not allowed: this action requires ${minLevel} access to ${moduleSlug}.`,
      moduleSlug,
      currentLevel: level,
      requiredLevel: minLevel,
    });
    return false;
  }
  return true;
}

// Convenience: get the full module set a user can see (for building
// sidebars / dashboards from the new system).
export async function getUserModules(userId: string, execId: string) {
  // Permission admin sees everything regardless of explicit grants.
  if (execId === PERMISSION_ADMIN_EXEC_ID) {
    const { query } = await import('./pg');
    return query<any>(
      `SELECT m.id, m.slug, m.name, m.route, m.icon, m."order",
              d.id AS "departmentId", d.slug AS "departmentSlug",
              d.name AS "departmentName", d.color AS "departmentColor",
              'admin'::text AS level
         FROM "Module" m
         JOIN "Department" d ON d.id = m."departmentId"
        WHERE m.active = true AND d.active = true
        ORDER BY d."order", m."order", m.name`,
    );
  }
  const { query } = await import('./pg');
  return query<any>(
    `SELECT m.id, m.slug, m.name, m.route, m.icon, m."order",
            d.id AS "departmentId", d.slug AS "departmentSlug",
            d.name AS "departmentName", d.color AS "departmentColor",
            p.level
       FROM "Permission" p
       JOIN "Module" m     ON m.id = p."moduleId"
       JOIN "Department" d ON d.id = m."departmentId"
      WHERE p."userId" = $1 AND m.active = true AND d.active = true
      ORDER BY d."order", m."order", m.name`,
    [userId],
  );
}
