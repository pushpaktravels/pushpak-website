// ============================================================
// Password hashing — argon2id with a pepper.
// ============================================================
// The pepper is a server-side secret mixed into every hash. If the
// database is ever leaked, an attacker still needs the pepper to
// run a brute-force — and the pepper lives only in env vars / Vercel.
// ============================================================
import argon2 from 'argon2';

const PEPPER = process.env.PASSWORD_PEPPER || '';
if (!PEPPER) {
  // Fail loudly at boot rather than silently degrading security
  throw new Error('PASSWORD_PEPPER is not set in environment');
}

const PEPPER_BUF = Buffer.from(PEPPER, 'hex');

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  // Memory cost in KiB; 64 MiB — OWASP minimum for 2024
  memoryCost: 65536,
  // Number of iterations
  timeCost: 3,
  // Parallelism (threads)
  parallelism: 1,
  secret: PEPPER_BUF,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain, { secret: PEPPER_BUF });
  } catch {
    return false;
  }
}
