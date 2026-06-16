// ============================================================
// add-overtime.ts — overtime = a day WORKED on a weekly-off / holiday.
// ============================================================
// Owner rule (2026-06-16): overtime is counted in whole DAYS, not hours.
// If someone punches in on their weekly-off or on a company holiday, that
// day stays paid as OFF_DAY/HOLIDAY (salary unchanged) but is ALSO flagged
// as an overtime day. At month-end a separate "Overtime" sheet lists each
// employee's name and their count of OT days.
//
// This migration is additive + idempotent:
//   • DailyAttendance."isOvertime"  BOOLEAN  — per-day flag (the source of truth)
//   • MonthlyPayroll."overtimeDays" INT      — frozen count in the payslip snapshot
//   • Back-fill: flag any already-uploaded OFF_DAY/HOLIDAY rows that have a
//     punch, so historical overtime shows up on the new page immediately.
//
// Portal only; nothing here touches FinBook.
//
//   npx tsx scripts/add-overtime.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  // 1) Per-day flag on the attendance row.
  await pool.query(
    `ALTER TABLE "DailyAttendance"
       ADD COLUMN IF NOT EXISTS "isOvertime" BOOLEAN NOT NULL DEFAULT FALSE`,
  );
  console.log('✓ DailyAttendance."isOvertime" present.');

  // 2) Frozen count on the monthly snapshot.
  await pool.query(
    `ALTER TABLE "MonthlyPayroll"
       ADD COLUMN IF NOT EXISTS "overtimeDays" INTEGER NOT NULL DEFAULT 0`,
  );
  console.log('✓ MonthlyPayroll."overtimeDays" present.');

  // 3) Back-fill history: an OFF_DAY / HOLIDAY with any punch = an overtime day.
  //    (Overridden rows are left for the owner to decide; we only touch the
  //     clearly-machine-classified off/holiday days that carry a punch.)
  const r = await pool.query(
    `UPDATE "DailyAttendance"
        SET "isOvertime" = TRUE, "updatedAt" = NOW()
      WHERE status IN ('OFF_DAY', 'HOLIDAY')
        AND ("actualIn" IS NOT NULL OR "actualOut" IS NOT NULL)
        AND "isOvertime" = FALSE`,
  );
  console.log(`✓ Back-filled ${r.rowCount ?? 0} historical overtime day(s).`);

  // Helpful index for the month-scoped Overtime sheet query.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "DailyAttendance_overtime_idx"
       ON "DailyAttendance" (date) WHERE "isOvertime" = TRUE`,
  );
  console.log('✓ Partial index for overtime lookups present.');

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
