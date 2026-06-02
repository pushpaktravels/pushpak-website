// ============================================================
// One-shot migration: create the "Package" table — shared by BOTH
// package desks (domestic-package + international-packages), separated by
// the `department` column. Idempotent (CREATE TABLE IF NOT EXISTS +
// ADD COLUMN IF NOT EXISTS), so it's safe to re-run.
//
//   npx tsx scripts/add-packages.ts
//
// Mirrors the Prisma model in prisma/schema.prisma. Runtime access is via
// node-postgres (lib/pg), so this raw DDL is the source of truth for the
// live table shape. The departure date drives a voucher-prep reminder
// Task (kind 'package_voucher') through lib/packages.ts.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Package" (
      "id"              TEXT PRIMARY KEY,
      "title"           TEXT NOT NULL,
      "department"      TEXT NOT NULL,
      "customerName"    TEXT NOT NULL,
      "contact"         TEXT,
      "email"           TEXT,
      "destination"     TEXT,
      "paxCount"        INTEGER NOT NULL DEFAULT 1,
      "travelStart"     TIMESTAMP(3),
      "travelEnd"       TIMESTAMP(3),
      "stage"           TEXT NOT NULL DEFAULT 'enquiry',
      "priority"        TEXT NOT NULL DEFAULT 'normal',
      "packageCost"     DECIMAL(12,2) NOT NULL DEFAULT 0,
      "amountCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "vendor"          TEXT,
      "refNo"           TEXT,
      "assigneeExecId"  TEXT,
      "assigneeName"    TEXT,
      "leadId"          TEXT,
      "notes"           TEXT,
      "createdBy"       TEXT,
      "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Package_stage_idx"       ON "Package" ("stage")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Package_department_idx"  ON "Package" ("department")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Package_travelStart_idx" ON "Package" ("travelStart")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Package_assignee_idx"    ON "Package" ("assigneeExecId")`);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Package' ORDER BY ordinal_position`
  );
  console.log('Package columns:', cols.rows.map((x: any) => x.column_name).join(', '));
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "Package"`);
  console.log('Existing Package rows:', count.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
