// ============================================================
// Auth middleware — call this at the top of every protected API route.
// Returns the authenticated user or sends a 401 and returns null.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne } from './pg';
import { COOKIE_NAMES, readCookie } from './cookies';
import { verifyAccessToken } from './jwt';
import { INSIGHTS_ONLY_EXEC_IDS } from './roles';
import type { User } from '@prisma/client';

export type AuthedUser = User & { _mfaPassed: boolean };

export async function requireAuth(
  req: NextApiRequest,
  res: NextApiResponse,
  opts: { requireMfa?: boolean } = { requireMfa: true }
): Promise<AuthedUser | null> {
  const token = readCookie(req.headers.cookie, COOKIE_NAMES.ACCESS);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Not signed in' });
    return null;
  }
  const claims = await verifyAccessToken(token);
  if (!claims) {
    res.status(401).json({ ok: false, error: 'Session expired' });
    return null;
  }
  if (opts.requireMfa !== false && !claims.mfa) {
    res.status(401).json({ ok: false, error: 'MFA required', needsMfa: true });
    return null;
  }
  // Use node-postgres directly — Prisma + Supabase pgbouncer keeps colliding
  // on prepared statements even with $queryRawUnsafe. pg uses unnamed queries
  // by default which pgbouncer handles cleanly.
  const user = await queryOne<any>(
    `SELECT * FROM "User" WHERE id = $1 LIMIT 1`,
    [claims.sub]
  );
  if (!user || !user.active) {
    res.status(401).json({ ok: false, error: 'Account inactive' });
    return null;
  }
  return { ...user, _mfaPassed: !!claims.mfa } as AuthedUser;
}

// Role gate — drop this in after requireAuth if an endpoint is owner-only etc.
export function hasRole(user: AuthedUser, ...allowed: string[]): boolean {
  // Insights-only identities (e.g. Vishal) are NEVER treated as owners or
  // admins, even if their row says so. They pass a gate only when it admits
  // the read-only 'insights' capability. This keeps owner-gated routes
  // (users, audit, settings, uploads, holds, attendance…) closed to them at
  // the API layer — not merely hidden in the nav. Vanshika stays a full owner.
  if (INSIGHTS_ONLY_EXEC_IDS.has(user.execId)) {
    return allowed.includes('insights');
  }
  return allowed.includes(user.role);
}

export function requireRole(
  user: AuthedUser,
  res: NextApiResponse,
  ...allowed: string[]
): boolean {
  if (!hasRole(user, ...allowed)) {
    res.status(403).json({ ok: false, error: 'Not allowed for your role' });
    return false;
  }
  return true;
}

// What exec NAMES can this user see? null = see-all.
// Per owner's directive: every role that can reach a Followup view sees
// every account within it (no per-exec name scoping). Team collaboration >
// silos for this org. Which ROLES can reach those views at all is now gated
// upstream by requireView() (lib/views.ts); this only controls name-level
// scoping once you're in.
// Audit-log entries still record WHO took an action, so accountability
// is preserved even though scope is wide-open.
export function visibleExecNames(_user: AuthedUser): Set<string> | null {
  return null;
}

// Get caller IP (Vercel sets x-forwarded-for; we take the first)
export function getIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd[0]) return fwd[0];
  return req.socket?.remoteAddress || '';
}
