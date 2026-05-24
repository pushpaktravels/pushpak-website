// ============================================================
// POST /api/login
// Body: { execId: string, password: string, totp?: string }
// ============================================================
// Step 1 (no totp in body): verify password, return either
//   - { ok: true, mfaEnrolled: true } → frontend prompts for 2FA code
//   - { ok: true, mfaEnrolled: false, enrollmentRequired: true } → for first-time users on roles that mandate 2FA
//   - { ok: true } + sets cookies → fully logged in (only for non-MFA roles)
// Step 2 (with totp in body): verify totp, complete login by setting full cookies.
//
// Brute-force defense:
//   - Per-IP rate limit (10 attempts / 5 min)
//   - Per-account: 5 failed attempts → 15-min lockout
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { signAccessToken } from '@/lib/jwt';
import { setAuthCookies } from '@/lib/cookies';
import { rateLimit } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';
import { verifyTotp } from '@/lib/totp';
import { getIp } from '@/lib/auth';
import crypto from 'crypto';

const BodySchema = z.object({
  execId: z.string().min(1).max(40).transform(s => s.toUpperCase().trim()),
  password: z.string().min(1).max(200),
  totp: z.string().min(6).max(8).optional(),
});

const LOCKOUT_AFTER_ATTEMPTS = 5;
const LOCKOUT_MIN = 15;

// 2FA is OPT-IN for now. If a user has enrolled (totpSecret is set), the
// login flow demands the code. If they haven't enrolled, password alone is
// accepted. Owner/admin can enroll later from a settings page.
// To make 2FA mandatory for specific roles, set ENFORCE_MFA=true in .env.
const MFA_REQUIRED_ROLES =
  process.env.ENFORCE_MFA === 'true' ? new Set(['owner', 'admin']) : new Set<string>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Per-IP rate limit BEFORE any DB work — keep brute-forcers cheap to reject
  const ip = getIp(req);
  const rl = rateLimit(`login:${ip}`, 10, 5 * 60 * 1000);
  if (!rl.ok) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
  }

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
  const { execId, password, totp } = parsed.data;

  const user = await prisma.user.findUnique({ where: { execId } });
  // Constant-time-ish: even when user doesn't exist, do a fake hash check to
  // mitigate timing attacks that would otherwise let an attacker enumerate IDs.
  if (!user) {
    await verifyPassword('$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password);
    await audit(req, null, 'LOGIN_FAIL', execId, { reason: 'unknown_id' });
    return res.status(401).json({ ok: false, error: 'Invalid ID or password' });
  }

  if (!user.active) {
    await audit(req, user, 'LOGIN_FAIL', user.execId, { reason: 'inactive' });
    return res.status(401).json({ ok: false, error: 'Account inactive' });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(429).json({
      ok: false,
      error: `Account locked until ${user.lockedUntil.toISOString().slice(11, 16)} UTC`,
    });
  }

  const passOk = await verifyPassword(user.passwordHash, password);
  if (!passOk) {
    const attempts = user.failedAttempts + 1;
    const data: any = { failedAttempts: attempts };
    if (attempts >= LOCKOUT_AFTER_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + LOCKOUT_MIN * 60 * 1000);
      data.failedAttempts = 0; // reset counter once locked
    }
    await prisma.user.update({ where: { id: user.id }, data });
    await audit(req, user, 'LOGIN_FAIL', user.execId, { reason: 'bad_password', attempts });
    return res.status(401).json({ ok: false, error: 'Invalid ID or password' });
  }

  // Password OK — reset counter
  if (user.failedAttempts > 0) {
    await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  // ── MFA gate ────────────────────────────────────────────────
  const mfaMandatory = MFA_REQUIRED_ROLES.has(user.role);
  const mfaEnrolled = !!user.totpSecret;

  // First-time MFA-required user without enrollment → kick them into enrollment flow
  if (mfaMandatory && !mfaEnrolled) {
    // Issue a "half token" so they can call /api/2fa/enroll
    const halfToken = await signAccessToken({ sub: user.id, execId: user.execId, role: user.role, mfa: false });
    const refresh = crypto.randomBytes(48).toString('hex');
    setAuthCookies(res, halfToken, refresh);
    return res.json({ ok: true, mfaEnrolled: false, enrollmentRequired: true, user: publicUser(user) });
  }

  // MFA required + enrolled → expect totp in this same request OR send half-token + prompt
  if (mfaMandatory && mfaEnrolled) {
    if (!totp) {
      const halfToken = await signAccessToken({ sub: user.id, execId: user.execId, role: user.role, mfa: false });
      setAuthCookies(res, halfToken, '');
      return res.json({ ok: true, mfaEnrolled: true, needsTotp: true, user: publicUser(user) });
    }
    if (!verifyTotp(user.totpSecret!, totp)) {
      await audit(req, user, 'LOGIN_FAIL', user.execId, { reason: 'bad_totp' });
      return res.status(401).json({ ok: false, error: 'Invalid 2FA code' });
    }
  }

  // ── Full login ──────────────────────────────────────────────
  const accessToken = await signAccessToken({
    sub: user.id, execId: user.execId, role: user.role, mfa: true,
  });
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      userAgent: (req.headers['user-agent'] || '').slice(0, 500),
      ip,
    },
  });
  setAuthCookies(res, accessToken, refreshToken);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip },
  });
  await audit(req, user, 'LOGIN_OK', user.execId);

  return res.json({ ok: true, user: publicUser(user) });
}

function publicUser(u: any) {
  return {
    id: u.id, execId: u.execId, name: u.name, role: u.role, badge: u.badge,
    team: u.team, scoreboard: u.scoreboard,
    viewPerms: u.viewPerms, viewReadOnly: u.viewReadOnly,
  };
}
