// ============================================================
// add-attendance-tables.ts — Attendance & Payroll module schema.
// ============================================================
// Idempotent, ADDITIVE migration. Creates the attendance/payroll
// tables only; never touches existing accounting tables. Safe to
// re-run (CREATE TABLE / INDEX IF NOT EXISTS).
//
// Run:  npx tsx scripts/add-attendance-tables.ts
// Uses DIRECT_URL (un-pooled) for DDL, like the other migration scripts.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

async function run() {
  // ─── Employee ────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Employee" (
      id                 TEXT PRIMARY KEY,
      "machineCode"      TEXT,
      "hrCode"           TEXT NOT NULL,
      name               TEXT NOT NULL,
      department         TEXT,
      designation        TEXT,
      mobile             TEXT,
      email              TEXT,
      dob                DATE,
      "joiningDate"      DATE,
      "monthlySalary"    NUMERIC(14,2) NOT NULL DEFAULT 0,
      "shiftIn"          TEXT,
      "shiftOut"         TEXT,
      "weeklyOffDay"     INT NOT NULL DEFAULT 0,
      "leavesCarryOver"  BOOLEAN NOT NULL DEFAULT FALSE,
      "carryOverDays"    NUMERIC(6,2) NOT NULL DEFAULT 0,
      active             BOOLEAN NOT NULL DEFAULT TRUE,
      "presentAddress"   TEXT,
      "permanentAddress" TEXT,
      "createdAt"        TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"        TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Employee_machineCode_key" ON "Employee"("machineCode")`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Employee_hrCode_key" ON "Employee"("hrCode")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Employee_active_idx" ON "Employee"(active)`);

  // ─── DailyAttendance ─────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "DailyAttendance" (
      id              TEXT PRIMARY KEY,
      "employeeId"    TEXT NOT NULL,
      "machineCode"   TEXT,
      date            DATE NOT NULL,
      "scheduledIn"   TEXT,
      "scheduledOut"  TEXT,
      "actualIn"      TEXT,
      "actualOut"     TEXT,
      "lateByMin"     INT NOT NULL DEFAULT 0,
      "earlyGoingMin" INT NOT NULL DEFAULT 0,
      "workDurMin"    INT NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'PRESENT',
      "isInformed"    BOOLEAN NOT NULL DEFAULT FALSE,
      "deductionDays" NUMERIC(6,2) NOT NULL DEFAULT 0,
      remark          TEXT,
      source          TEXT NOT NULL DEFAULT 'biometric',
      overridden      BOOLEAN NOT NULL DEFAULT FALSE,
      "overrideBy"    TEXT,
      "overrideAt"    TIMESTAMP,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "DailyAttendance_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "DailyAttendance_employeeId_date_key" ON "DailyAttendance"("employeeId", date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "DailyAttendance_date_idx" ON "DailyAttendance"(date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "DailyAttendance_machineCode_idx" ON "DailyAttendance"("machineCode")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "DailyAttendance_status_idx" ON "DailyAttendance"(status)`);

  // ─── Holiday ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Holiday" (
      id          TEXT PRIMARY KEY,
      date        DATE NOT NULL,
      name        TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Holiday_date_key" ON "Holiday"(date)`);

  // ─── LeaveRequest ────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "LeaveRequest" (
      id           TEXT PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "fromDate"   DATE NOT NULL,
      "toDate"     DATE NOT NULL,
      days         NUMERIC(6,2) NOT NULL,
      reason       TEXT,
      status       TEXT NOT NULL DEFAULT 'PENDING',
      kind         TEXT,
      "appliedBy"  TEXT,
      "decidedBy"  TEXT,
      "decidedAt"  TIMESTAMP,
      notes        TEXT,
      "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "LeaveRequest_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "LeaveRequest_employeeId_idx" ON "LeaveRequest"("employeeId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "LeaveRequest_status_idx" ON "LeaveRequest"(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "LeaveRequest_fromDate_idx" ON "LeaveRequest"("fromDate")`);

  // ─── LeaveBalance ────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "LeaveBalance" (
      id              TEXT PRIMARY KEY,
      "employeeId"    TEXT NOT NULL,
      "financialYear" TEXT NOT NULL,
      opening         NUMERIC(6,2) NOT NULL DEFAULT 18,
      used            NUMERIC(6,2) NOT NULL DEFAULT 0,
      remaining       NUMERIC(6,2) NOT NULL DEFAULT 18,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "LeaveBalance_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "LeaveBalance_employeeId_financialYear_key" ON "LeaveBalance"("employeeId", "financialYear")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "LeaveBalance_employeeId_idx" ON "LeaveBalance"("employeeId")`);

  // ─── Advance ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Advance" (
      id                   TEXT PRIMARY KEY,
      "employeeId"         TEXT NOT NULL,
      principal            NUMERIC(14,2) NOT NULL,
      "monthlyInstallment" NUMERIC(14,2) NOT NULL,
      "startMonth"         TEXT NOT NULL,
      "remainingBalance"   NUMERIC(14,2) NOT NULL,
      active               BOOLEAN NOT NULL DEFAULT TRUE,
      notes                TEXT,
      "createdAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "Advance_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Advance_employeeId_idx" ON "Advance"("employeeId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Advance_active_idx" ON "Advance"(active)`);

  // ─── AdvanceDeduction ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "AdvanceDeduction" (
      id           TEXT PRIMARY KEY,
      "advanceId"  TEXT NOT NULL,
      "employeeId" TEXT NOT NULL,
      month        TEXT NOT NULL,
      amount       NUMERIC(14,2) NOT NULL,
      "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "AdvanceDeduction_advanceId_fkey"
        FOREIGN KEY ("advanceId") REFERENCES "Advance"(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "AdvanceDeduction_advanceId_month_key" ON "AdvanceDeduction"("advanceId", month)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "AdvanceDeduction_employeeId_idx" ON "AdvanceDeduction"("employeeId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "AdvanceDeduction_month_idx" ON "AdvanceDeduction"(month)`);

  // ─── MonthlyPayroll ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "MonthlyPayroll" (
      id                  TEXT PRIMARY KEY,
      "employeeId"        TEXT NOT NULL,
      month               TEXT NOT NULL,
      "daysInMonth"       INT NOT NULL,
      "presentDays"       NUMERIC(6,2) NOT NULL DEFAULT 0,
      "halfDays"          NUMERIC(6,2) NOT NULL DEFAULT 0,
      "paidLeaves"        NUMERIC(6,2) NOT NULL DEFAULT 0,
      "lwpDays"           NUMERIC(6,2) NOT NULL DEFAULT 0,
      "paidHolidays"      NUMERIC(6,2) NOT NULL DEFAULT 0,
      "weeklyOffs"        NUMERIC(6,2) NOT NULL DEFAULT 0,
      "onDutyDays"        NUMERIC(6,2) NOT NULL DEFAULT 0,
      "lateCount"         INT NOT NULL DEFAULT 0,
      "lateDeductionDays" NUMERIC(6,2) NOT NULL DEFAULT 0,
      "netPayableDays"    NUMERIC(6,2) NOT NULL DEFAULT 0,
      "perDaySalary"      NUMERIC(14,2) NOT NULL DEFAULT 0,
      "grossSalary"       NUMERIC(14,2) NOT NULL DEFAULT 0,
      "advanceDeduction"  NUMERIC(14,2) NOT NULL DEFAULT 0,
      "netSalary"         NUMERIC(14,2) NOT NULL DEFAULT 0,
      finalized           BOOLEAN NOT NULL DEFAULT FALSE,
      "finalizedBy"       TEXT,
      "finalizedAt"       TIMESTAMP,
      "createdAt"         TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"         TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "MonthlyPayroll_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyPayroll_employeeId_month_key" ON "MonthlyPayroll"("employeeId", month)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "MonthlyPayroll_month_idx" ON "MonthlyPayroll"(month)`);

  // ─── AttendanceUpload ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "AttendanceUpload" (
      id             TEXT PRIMARY KEY,
      ts             TIMESTAMP NOT NULL DEFAULT NOW(),
      "byWhom"       TEXT NOT NULL,
      "fileNames"    TEXT NOT NULL,
      "reportDate"   DATE,
      "rowsParsed"   INT NOT NULL DEFAULT 0,
      matched        INT NOT NULL DEFAULT 0,
      unmatched      INT NOT NULL DEFAULT 0,
      "daysUpserted" INT NOT NULL DEFAULT 0,
      notes          TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "AttendanceUpload_ts_idx" ON "AttendanceUpload"(ts)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "AttendanceUpload_reportDate_idx" ON "AttendanceUpload"("reportDate")`);

  console.log('Attendance & Payroll tables ready (Employee, DailyAttendance, Holiday, LeaveRequest, LeaveBalance, Advance, AdvanceDeduction, MonthlyPayroll, AttendanceUpload).');
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Migration failed:', err);
    await pool.end();
    process.exit(1);
  });
