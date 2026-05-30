// ============================================================
// add-employee-login-link.ts — link an Employee to a portal login.
// ============================================================
// Idempotent, ADDITIVE. Adds Employee."loginExecId" (the User.execId of
// the person's portal login) so the attendance/payroll master can resolve
// "this logged-in user → their own employee record" for self-service.
//
// We DELIBERATELY do NOT add a column to the User table: the link lives on
// the Employee (attendance) side, matched by name with owner confirmation,
// so existing logins are never disturbed.
//
// Run:  npx tsx scripts/add-employee-login-link.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

async function run() {
  await pool.query(`ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "loginExecId" TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Employee_loginExecId_key" ON "Employee"("loginExecId")`);
  console.log('Employee.loginExecId ready (nullable, unique).');
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Migration failed:', err);
    await pool.end();
    process.exit(1);
  });
