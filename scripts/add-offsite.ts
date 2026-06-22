// ============================================================
// add-offsite.ts — offsite (field / second-location) attendance.
// ============================================================
// Some staff never punch the office biometric machine — field
// executives who move between client sites, and people posted at a
// fixed second location. They record attendance themselves from their
// phone (a GPS-stamped check-in / check-out); on a working day with no
// check-in they are auto-absent.
//
// Two additive, idempotent changes:
//   1. Employee."attendanceMode"  — 'biometric' (default, the office
//      machine) or 'offsite' (self check-in). The owner flips this in
//      the Employees master.
//   2. "OffsiteCheckin"           — the raw GPS event log. One row per
//      check-in / check-out, with lat/long + accuracy. The derived
//      DailyAttendance row (source 'offsite') is what payroll reads;
//      this table is the verifiable audit trail behind it.
//
//   npx tsx scripts/add-offsite.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  // 1. attendance mode on the employee master.
  await pool.query(
    `ALTER TABLE "Employee"
       ADD COLUMN IF NOT EXISTS "attendanceMode" TEXT NOT NULL DEFAULT 'biometric'`,
  );
  console.log('✓ Employee."attendanceMode" present (default \'biometric\').');

  // 2. raw GPS check-in / check-out event log.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "OffsiteCheckin" (
       id          TEXT PRIMARY KEY,
       "employeeId" TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
       date        DATE NOT NULL,
       kind        TEXT NOT NULL,                 -- 'IN' | 'OUT'
       "at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       lat         DOUBLE PRECISION,
       lng         DOUBLE PRECISION,
       accuracy    DOUBLE PRECISION,              -- GPS accuracy in metres, if reported
       note        TEXT,
       "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS "OffsiteCheckin_emp_date_idx" ON "OffsiteCheckin" ("employeeId", date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "OffsiteCheckin_date_idx" ON "OffsiteCheckin" (date)`);
  console.log('✓ "OffsiteCheckin" table + indexes present.');

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
