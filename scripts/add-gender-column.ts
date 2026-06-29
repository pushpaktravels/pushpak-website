// scripts/add-gender-column.ts — adds Employee.gender, the field that makes
// an employee eligible for monthly Period Leave (eligibility = 'female').
//
// Additive + idempotent + SAFE: a nullable text column. Every existing
// employee therefore starts with gender = NULL = "unspecified", which is
// NOT eligible for period leave — so NOTHING changes until the owner sets a
// gender on someone in the employee master. No data is moved or dropped.
//
// READ-ONLY by default (prints the plan). Pass --commit to run the ALTER.
//   preview: node_modules/.bin/tsx scripts/add-gender-column.ts
//   apply:   node_modules/.bin/tsx scripts/add-gender-column.ts --commit
import 'dotenv/config';
import { query } from '../lib/pg';

const COMMIT = process.argv.includes('--commit');
const ALTER = `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS gender text`;

async function columnExists(): Promise<boolean> {
  const rows = await query<any>(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'Employee' AND column_name = 'gender' LIMIT 1`);
  return rows.length > 0;
}

async function main() {
  const before = await columnExists();
  console.log(`\nEmployee.gender exists: ${before ? 'YES' : 'NO'}`);
  if (before) { console.log('Column already present — idempotent no-op. DONE.'); process.exit(0); }

  if (!COMMIT) {
    console.log('\nWould run:\n  ' + ALTER + ';');
    console.log('\nRead-only. Re-run with --commit to apply.');
    process.exit(0);
  }

  await query(ALTER);
  const after = await columnExists();
  const c = await query<any>(`SELECT COUNT(*)::int AS n FROM "Employee"`);
  console.log(`\n[commit] ALTER applied. Employee.gender exists: ${after ? 'YES' : 'NO (??)'}`);
  console.log(`Employees: ${c[0]?.n ?? '?'} — all start with gender NULL (not period-leave eligible).`);
  console.log('DONE.');
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
