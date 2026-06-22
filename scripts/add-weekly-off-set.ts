// ============================================================
// add-weekly-off-set.ts — track whether an employee's weekly-off day
// has been explicitly confirmed (vs left on the Sunday default).
// ============================================================
// The weekly-off day drives both payroll (an off day is paid, a missed
// working day is LWP) and overtime (a punch on the off day = 1 OT day).
// New / biometric-imported employees default to Sunday (day 0), which is
// indistinguishable from a real "Sunday off". This boolean lets the
// Employees master flag anyone whose day hasn't been confirmed, so none
// silently sit on the wrong default.
//
// Additive + idempotent. Back-fill assumes existing NON-stub employees
// were set up intentionally (true); biometric stubs (hrCode "BIO-…") are
// flagged for review (false). The Employees API flips this to true on any
// save of the weekly-off day.
//
//   npx tsx scripts/add-weekly-off-set.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(
    `ALTER TABLE "Employee"
       ADD COLUMN IF NOT EXISTS "weeklyOffSet" BOOLEAN NOT NULL DEFAULT FALSE`,
  );
  console.log('✓ Employee."weeklyOffSet" present.');

  // Treat already-enriched (non-stub) employees as intentionally set;
  // leave biometric stubs flagged for review.
  const r = await pool.query(
    `UPDATE "Employee"
        SET "weeklyOffSet" = TRUE, "updatedAt" = NOW()
      WHERE "weeklyOffSet" = FALSE
        AND "hrCode" NOT LIKE 'BIO-%'`,
  );
  console.log(`✓ Marked ${r.rowCount ?? 0} existing non-stub employee(s) as confirmed.`);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
