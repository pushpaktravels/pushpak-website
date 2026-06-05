// ============================================================
// One-shot migration: remember a FinBook ledger code per client.
//   Adds "Account"."finbookClientId" — the FinBook client id ("CCA…")
//   that a debtor account bills to. Once an accounts user confirms it on
//   the FinBook console, picking that client by NAME auto-fills the code,
//   so nobody re-types "CCA000001" by hand again.
//
// Portal only — it does NOT touch FinBook. Idempotent (ADD COLUMN IF NOT
// EXISTS), safe to re-run.
//   npx tsx scripts/add-finbook-client-id.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "finbookClientId" TEXT`);
  // Lets us look an account up BY its FinBook code too (reverse direction).
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "Account_finbookClientId_idx" ON "Account" ("finbookClientId")`,
  );
  console.log('✓ Account.finbookClientId ready');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
