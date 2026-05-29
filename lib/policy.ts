// ============================================================
// lib/policy.ts — password & login security policy.
// ============================================================
// The single source of truth for "how strong must a password be"
// and "how aggressively do we lock out brute-forcers". Values are
// read from the "Setting" table (category 'security') so the owner
// can tune them live from /portal/settings, with HARD FALLBACKS to
// the behaviour that shipped before this module existed — if the
// Setting rows are missing or the DB read fails, login & password
// validation behave EXACTLY as they did before. Security knobs must
// never fail open or fail closed unexpectedly.
//
// Read by:
//   • pages/api/login.ts        — lockout thresholds
//   • pages/api/users.ts        — password strength on create/update
//   • pages/api/me/change-password.ts — password strength + rotation
// ============================================================
import { query } from './pg';

export type SecurityPolicy = {
  passwordMinLength: number;
  passwordRequireMixed: boolean; // require upper + lower + digit
  lockoutAttempts: number;       // failed tries before lockout
  lockoutMinutes: number;        // how long the lockout lasts
  sessionIdleMinutes: number;    // client-side idle auto-logout
  passwordMaxAgeDays: number;    // 0 = never expire
};

// Defaults mirror the pre-migration hard-coded constants exactly.
export const DEFAULT_POLICY: SecurityPolicy = {
  passwordMinLength: 8,
  passwordRequireMixed: false,
  lockoutAttempts: 5,
  lockoutMinutes: 15,
  sessionIdleMinutes: 30,
  passwordMaxAgeDays: 0,
};

// 30-second in-process cache so a burst of logins doesn't hammer the
// Setting table. Short enough that a policy edit takes effect almost
// immediately.
let cache: { at: number; policy: SecurityPolicy } | null = null;
const CACHE_MS = 30_000;

const toInt = (v: string | undefined, fallback: number): number => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const toBool = (v: string | undefined, fallback: boolean): boolean => {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (['on', 'true', 'yes', '1'].includes(s)) return true;
  if (['off', 'false', 'no', '0'].includes(s)) return false;
  return fallback;
};

export async function getSecurityPolicy(): Promise<SecurityPolicy> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.policy;
  try {
    const rows = await query<{ key: string; value: string }>(
      `SELECT key, value FROM "Setting" WHERE category = 'security'`,
      []
    );
    const m = new Map(rows.map(r => [r.key, r.value]));
    const policy: SecurityPolicy = {
      passwordMinLength:    Math.max(4, toInt(m.get('PASSWORD_MIN_LENGTH'), DEFAULT_POLICY.passwordMinLength)),
      passwordRequireMixed: toBool(m.get('PASSWORD_REQUIRE_MIXED'), DEFAULT_POLICY.passwordRequireMixed),
      lockoutAttempts:      Math.max(1, toInt(m.get('LOGIN_LOCKOUT_ATTEMPTS'), DEFAULT_POLICY.lockoutAttempts)),
      lockoutMinutes:       Math.max(1, toInt(m.get('LOGIN_LOCKOUT_MINUTES'), DEFAULT_POLICY.lockoutMinutes)),
      sessionIdleMinutes:   Math.max(1, toInt(m.get('SESSION_IDLE_MINUTES'), DEFAULT_POLICY.sessionIdleMinutes)),
      passwordMaxAgeDays:   toInt(m.get('PASSWORD_MAX_AGE_DAYS'), DEFAULT_POLICY.passwordMaxAgeDays),
    };
    cache = { at: Date.now(), policy };
    return policy;
  } catch {
    // DB hiccup or the Setting table / category isn't there yet:
    // fall back to the shipped defaults rather than blocking logins.
    return DEFAULT_POLICY;
  }
}

// Validate a plaintext password against the live policy. Returns an
// error string to show the user, or null if the password is OK.
export async function validatePassword(plain: string, policy?: SecurityPolicy): Promise<string | null> {
  const p = policy ?? (await getSecurityPolicy());
  if (!plain || plain.length < p.passwordMinLength) {
    return `Password must be at least ${p.passwordMinLength} characters.`;
  }
  if (p.passwordRequireMixed) {
    if (!/[a-z]/.test(plain) || !/[A-Z]/.test(plain) || !/[0-9]/.test(plain)) {
      return 'Password must include an uppercase letter, a lowercase letter, and a number.';
    }
  }
  return null;
}

// Clear the cache so a settings PATCH takes effect immediately for
// the very next request (called from /api/settings after a save).
export function bustPolicyCache() {
  cache = null;
}
