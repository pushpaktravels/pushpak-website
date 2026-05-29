// ============================================================
// One-shot migration: per-user security columns + default
// password/login policy settings. Idempotent (IF NOT EXISTS /
// ON CONFLICT DO NOTHING), so it's safe to re-run.
//
//   npx tsx scripts/add-security-columns.ts
//
// Adds to "User":
//   • mustChangePassword  — force a password change at next login
//   • mfaRequired         — per-user 2FA mandate (independent of the
//                           role-level ENFORCE_MFA env switch)
//   • passwordChangedAt   — when the password was last rotated
//
// Seeds the 'security' category of "Setting" with the password &
// login policy keys the portal reads at runtime (login.ts +
// lib/policy.ts). Existing rows are never overwritten.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

// key, value, category — defaults match the hard-coded behaviour
// that shipped before this migration, so turning the knobs is
// opt-in and nothing changes until the owner edits them.
const DEFAULT_SETTINGS: [string, string, string][] = [
  ['PASSWORD_MIN_LENGTH',     '8',   'security'],
  ['PASSWORD_REQUIRE_MIXED',  'off', 'security'], // upper+lower+digit
  ['LOGIN_LOCKOUT_ATTEMPTS',  '5',   'security'],
  ['LOGIN_LOCKOUT_MINUTES',   '15',  'security'],
  ['SESSION_IDLE_MINUTES',    '30',  'security'],
  ['PASSWORD_MAX_AGE_DAYS',   '0',   'security'], // 0 = never expire
];

(async () => {
  await pool.query(`
    ALTER TABLE "User"
      ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "mfaRequired"        BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "passwordChangedAt"  TIMESTAMP(3)
  `);

  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'User'
       AND column_name IN ('mustChangePassword', 'mfaRequired', 'passwordChangedAt')
     ORDER BY column_name
  `);
  console.log('User security columns present:', cols.rows.map((x: any) => x.column_name).join(', '));

  for (const [key, value, category] of DEFAULT_SETTINGS) {
    await pool.query(
      `INSERT INTO "Setting" (key, value, category, "updatedAt", "updatedBy")
       VALUES ($1, $2, $3, NOW(), 'migration')
       ON CONFLICT (key) DO NOTHING`,
      [key, value, category]
    );
  }
  const s = await pool.query(
    `SELECT key, value FROM "Setting" WHERE category = 'security' ORDER BY key`
  );
  console.log('Security settings:', s.rows.map((r: any) => `${r.key}=${r.value}`).join(', '));

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
