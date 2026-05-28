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
//
// Uses node-postgres (lib/pg) — Prisma+pgbouncer prepared-statement
// collisions on Supabase serverless break the typed Prisma client.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
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

// Tiny IPv4 + CIDR match. Supports "1.2.3.4" and "1.2.0.0/16".
// Returns false for malformed entries.
function ipMatches(ip: string, entry: string): boolean {
  if (!ip || !entry) return false;
  if (entry === ip) return true;
  if (!entry.includes('/')) return false;
  const [prefix, bitsStr] = entry.split('/');
  const bits = parseInt(bitsStr, 10);
  if (!isFinite(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string) => s.split('.').reduce((n, p) => (n << 8) + (parseInt(p, 10) & 0xff), 0) >>> 0;
  const a = toInt(ip), b = toInt(prefix);
  if (!isFinite(a) || !isFinite(b)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

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

  try {
    const user = await queryOne<any>(
      `SELECT * FROM "User" WHERE "execId" = $1 LIMIT 1`,
      [execId]
    );

    // Constant-time-ish: even when user doesn't exist, do a fake hash check to
    // mitigate timing attacks that would otherwise let an attacker enumerate IDs.
    if (!user) {
      await verifyPassword(
        '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        password
      );
      await audit(req, null, 'LOGIN_FAIL', execId, { reason: 'unknown_id' });
      return res.status(401).json({ ok: false, error: 'Invalid ID or password' });
    }

    if (!user.active) {
      await audit(req, user, 'LOGIN_FAIL', user.execId, { reason: 'inactive' });
      return res.status(401).json({ ok: false, error: 'Account inactive' });
    }

    // Owner IP allowlist — when configured, the owner role can only
    // sign in from the IPs / CIDRs listed in the Setting. Empty value
    // = no restriction. Other roles are not affected.
    if (user.role === 'owner') {
      const allowlistSetting = await queryOne<any>(
        `SELECT value FROM "Setting" WHERE key = 'OWNER_IP_ALLOWLIST' LIMIT 1`
      );
      const raw = (allowlistSetting?.value || '').trim();
      if (raw) {
        const ip = getIp(req);
        const ok = raw.split(',').map((x: string) => x.trim()).filter(Boolean)
          .some((entry: string) => ipMatches(ip, entry));
        if (!ok) {
          await audit(req, user, 'LOGIN_FAIL', user.execId, { reason: 'ip_not_in_allowlist', ip });
          return res.status(403).json({ ok: false, error: 'Owner login blocked: your IP is not on the allowlist.' });
        }
      }
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return res.status(429).json({
        ok: false,
        error: `Account locked until ${new Date(user.lockedUntil).toISOString().slice(11, 16)} UTC`,
      });
    }

    const passOk = await verifyPassword(user.passwordHash, password);
    if (!passOk) {
      const attempts = (user.failedAttempts || 0) + 1;
      if (attempts >= LOCKOUT_AFTER_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_MIN * 60 * 1000).toISOString();
        await query(
          `UPDATE "User" SET "failedAttempts" = 0, "lockedUntil" = $1, "updatedAt" = NOW() WHERE id = $2`,
          [lockUntil, user.id]
        );
      } else {
        await query(
          `UPDATE "User" SET "failedAttempts" = $1, "updatedAt" = NOW() WHERE id = $2`,
          [attempts, user.id]
        );
      }
      await audit(req, user, 'LOGIN_FAIL', user.execId, { reason: 'bad_password', attempts });
      return res.status(401).json({ ok: false, error: 'Invalid ID or password' });
    }

    // Password OK — reset counter if it was non-zero
    if ((user.failedAttempts || 0) > 0 || user.lockedUntil) {
      await query(
        `UPDATE "User" SET "failedAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = NOW() WHERE id = $1`,
        [user.id]
      );
    }

    // ── MFA gate ────────────────────────────────────────────────
    const mfaMandatory = MFA_REQUIRED_ROLES.has(user.role);
    const mfaEnrolled = !!user.totpSecret;

    // First-time MFA-required user without enrollment → kick them into enrollment flow
    if (mfaMandatory && !mfaEnrolled) {
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
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    await query(
      `INSERT INTO "RefreshToken" (id, "userId", "tokenHash", "expiresAt", "userAgent", ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId('rt'), user.id, refreshHash, expiresAt, (req.headers['user-agent'] || '').slice(0, 500), ip]
    );

    setAuthCookies(res, accessToken, refreshToken);

    await query(
      `UPDATE "User" SET "lastLoginAt" = NOW(), "lastLoginIp" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [ip, user.id]
    );
    await audit(req, user, 'LOGIN_OK', user.execId);

    return res.json({ ok: true, user: publicUser(user) });
  } catch (err: any) {
    console.error('[api/login] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Login failed' });
  }
}

function publicUser(u: any) {
  return {
    id: u.id, execId: u.execId, name: u.name, role: u.role, badge: u.badge,
    team: u.team, scoreboard: u.scoreboard,
    viewPerms: u.viewPerms, viewReadOnly: u.viewReadOnly,
  };
}
