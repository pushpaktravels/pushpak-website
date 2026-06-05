// ============================================================
// One-shot migration: the reconciliation status board.
//   "RecoAccount" — the master list of things to reconcile (bank accounts,
//                   airline accounts), each with a cadence.
//   "RecoLog"     — one row per (account, period) reconciliation event.
// Replaces Shashank's bank-reco Excel + Reeta's airline-reco Excel. Portal
// only — it does NOT touch FinBook.
//
// Idempotent (CREATE TABLE / INDEX IF NOT EXISTS), safe to re-run.
//   npx tsx scripts/add-reco.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "RecoAccount" (
      "id"          TEXT PRIMARY KEY,
      "kind"        TEXT NOT NULL DEFAULT 'bank',   -- 'bank' | 'airline'
      "name"        TEXT NOT NULL,
      "identifier"  TEXT,                            -- a/c no, airline code, etc.
      "cadence"     TEXT NOT NULL DEFAULT 'daily',  -- 'daily' | 'weekly' | 'monthly'
      "department"  TEXT,
      "ownerName"   TEXT,                            -- who normally reconciles it
      "sortOrder"   INTEGER NOT NULL DEFAULT 0,
      "active"      BOOLEAN NOT NULL DEFAULT TRUE,
      "createdBy"   TEXT,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "RecoAccount_active_idx" ON "RecoAccount" ("active")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "RecoAccount_kind_idx"   ON "RecoAccount" ("kind")`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "RecoLog" (
      "id"                 TEXT PRIMARY KEY,
      "accountId"          TEXT NOT NULL,
      "periodKey"          TEXT NOT NULL,            -- 2026-06-03 | 2026-W23 | 2026-06
      "periodLabel"        TEXT,
      "status"             TEXT NOT NULL DEFAULT 'done',  -- 'done' | 'flagged'
      "statementBalance"   DECIMAL(14,2),
      "bookBalance"        DECIMAL(14,2),
      "difference"         DECIMAL(14,2),
      "note"               TEXT,
      "reconciledByExecId" TEXT,
      "reconciledByName"   TEXT,
      "reconciledAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  // One reconciliation per account per period — mark is an upsert on this.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "RecoLog_account_period_uidx" ON "RecoLog" ("accountId", "periodKey")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "RecoLog_account_idx" ON "RecoLog" ("accountId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "RecoLog_recAt_idx"   ON "RecoLog" ("reconciledAt")`);

  const a = await pool.query(`SELECT COUNT(*)::int AS n FROM "RecoAccount"`);
  const l = await pool.query(`SELECT COUNT(*)::int AS n FROM "RecoLog"`);
  console.log('RecoAccount rows:', a.rows[0].n, '· RecoLog rows:', l.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
