// ============================================================
// One-shot migration: create the "VisaApplication" table — the visa
// desk's application tracker. Idempotent (CREATE TABLE IF NOT EXISTS +
// ADD COLUMN IF NOT EXISTS), so it's safe to re-run.
//
//   npx tsx scripts/add-visa.ts
//
// Mirrors the Prisma model in prisma/schema.prisma. Runtime access is
// via node-postgres (lib/pg), so this raw DDL is the source of truth for
// the live table shape. The appointment date drives an auto reminder
// Task (kind 'visa_appointment') through lib/visa.ts.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "VisaApplication" (
      "id"              TEXT PRIMARY KEY,
      "applicantName"   TEXT NOT NULL,
      "passportNo"      TEXT,
      "contact"         TEXT,
      "email"           TEXT,
      "nationality"     TEXT DEFAULT 'Indian',
      "country"         TEXT NOT NULL,
      "visaType"        TEXT NOT NULL DEFAULT 'tourist',
      "stage"           TEXT NOT NULL DEFAULT 'enquiry',
      "priority"        TEXT NOT NULL DEFAULT 'normal',
      "appointmentAt"   TIMESTAMP(3),
      "submittedAt"     TIMESTAMP(3),
      "decisionAt"      TIMESTAMP(3),
      "fee"             DECIMAL(12,2) NOT NULL DEFAULT 0,
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
  await pool.query(`CREATE INDEX IF NOT EXISTS "VisaApplication_stage_idx"       ON "VisaApplication" ("stage")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "VisaApplication_appointment_idx" ON "VisaApplication" ("appointmentAt")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "VisaApplication_assignee_idx"    ON "VisaApplication" ("assigneeExecId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "VisaApplication_country_idx"     ON "VisaApplication" ("country")`);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'VisaApplication' ORDER BY ordinal_position`
  );
  console.log('VisaApplication columns:', cols.rows.map((x: any) => x.column_name).join(', '));
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "VisaApplication"`);
  console.log('Existing VisaApplication rows:', count.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
