// One-shot migration: add familyOverride + execOverride columns.
// Idempotent (uses IF NOT EXISTS).
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  await pool.query(`
    ALTER TABLE "Account"
      ADD COLUMN IF NOT EXISTS "familyOverride" TEXT,
      ADD COLUMN IF NOT EXISTS "execOverride"   TEXT
  `);
  const r = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'Account'
       AND column_name IN ('familyOverride', 'execOverride', 'tierOverride', 'alertOverride')
     ORDER BY column_name
  `);
  console.log('Override columns present:', r.rows.map(x => x.column_name).join(', '));
  await pool.end();
})();
