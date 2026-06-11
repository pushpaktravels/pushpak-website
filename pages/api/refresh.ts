// ============================================================
// POST /api/refresh — silently renew the access token.
// ============================================================
// The access token is deliberately short-lived. Before this endpoint
// existed it simply expired after 15 minutes and the very next request
// 401'd → the client bounced to /login. That was the "logged out every
// 15-20 minutes" complaint: not a security event, just a missing renewal.
//
// Here we trade the long-lived refresh token (HttpOnly cookie, hashed in
// the RefreshToken table) for a fresh access token, WITHOUT asking the
// user to sign in again. We keep the SAME refresh token value (no
// rotation) so two browser tabs refreshing at once can't race each other
// into a logout, and we SLIDE its expiry forward — an operator who keeps
// using the portal is never signed out involuntarily.
//
// Safety: a valid DB refresh token only ever exists for a FULLY
// authenticated (post-2FA) login — the half-login paths in /api/login set
// a cookie that is never stored — so minting mfa:true here is correct.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/pg';
import { COOKIE_NAMES, readCookie, setAuthCookies, clearAuthCookies } from '@/lib/cookies';
import { signAccessToken, REFRESH_TOKEN_TTL_SECONDS } from '@/lib/jwt';
import { ensureRoleDefaultsLoaded } from '@/lib/roledefaults-server';
import { effectiveRoleDefaults } from '@/lib/roledefaults';
import { getSecurityPolicy } from '@/lib/policy';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const raw = readCookie(req.headers.cookie, COOKIE_NAMES.REFRESH);
  if (!raw) {
    clearAuthCookies(res);
    return res.status(401).json({ ok: false, error: 'No session' });
  }

  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const token = await queryOne<any>(
    `SELECT * FROM "RefreshToken" WHERE "tokenHash" = $1 LIMIT 1`,
    [hash]
  );
  if (!token || token.revokedAt || new Date(token.expiresAt) <= new Date()) {
    // Unknown, revoked, or expired refresh token → genuinely sign out.
    clearAuthCookies(res);
    return res.status(401).json({ ok: false, error: 'Session expired' });
  }

  const user = await queryOne<any>(`SELECT * FROM "User" WHERE id = $1 LIMIT 1`, [token.userId]);
  if (!user || !user.active) {
    clearAuthCookies(res);
    return res.status(401).json({ ok: false, error: 'Account inactive' });
  }

  // Fresh access token (mfa already passed — see note above).
  const accessToken = await signAccessToken({
    sub: user.id, execId: user.execId, role: user.role, mfa: true,
  });

  // Slide the refresh token's expiry forward (rolling session). Same value
  // re-issued so concurrent tabs don't invalidate each other.
  const newExpiry = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
  await query(`UPDATE "RefreshToken" SET "expiresAt" = $1 WHERE id = $2`, [newExpiry, token.id]);
  setAuthCookies(res, accessToken, raw);

  // Return the same user payload as /api/me so the client can refresh its
  // cached identity in one round-trip if it needs to.
  await ensureRoleDefaultsLoaded();
  const policy = await getSecurityPolicy().catch(() => null);
  return res.json({
    ok: true,
    user: {
      id: user.id, execId: user.execId, name: user.name, role: user.role, badge: user.badge,
      team: user.team, scoreboard: user.scoreboard,
      viewPerms: user.viewPerms, viewReadOnly: user.viewReadOnly,
      roleViews: effectiveRoleDefaults()[user.role] || [],
      sessionIdleMinutes: policy?.sessionIdleMinutes ?? 30,
      mustChangePassword: !!user.mustChangePassword,
    },
  });
}
