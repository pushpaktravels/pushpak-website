// scripts/add-formperms-column.ts — adds User.formPerms (the per-employee
// form-fill override that the Users & Authorities "Forms this user can fill"
// picker writes to).
//
// Additive + idempotent + SAFE: a text[] column defaulting to '{}'. Every
// existing user therefore starts with an empty list = "inherit the role
// default", so NOTHING about who-can-fill-what changes until the owner ticks
// forms for someone. No data is moved or dropped.
//
// READ-ONLY by default (prints the plan). Pass --commit to run the ALTER.
//   preview: node_modules/.bin/tsx scripts/add-formperms-column.ts
//   apply:   node_modules/.bin/tsx scripts/add-formperms-column.ts --commit
import 'dotenv/config';
import { query } from '../lib/pg';

const COMMIT = process.argv.includes('--commit');
const ALTER = `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "formPerms" text[] NOT NULL DEFAULT '{}'`;

async function columnExists(): Promise<boolean> {
  const rows = await query<any>(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'formPerms' LIMIT 1`);
  return rows.length > 0;
}

async function main() {
  const before = await columnExists();
  console.log(`\nUser.formPerms exists: ${before ? 'YES' : 'NO'}`);
  if (before) { console.log('Column already present — idempotent no-op. DONE.'); process.exit(0); }

  if (!COMMIT) {
    console.log('\nWould run:\n  ' + ALTER + ';');
    console.log('\nRead-only. Re-run with --commit to apply.');
    process.exit(0);
  }

  await query(ALTER);
  const after = await columnExists();
  const c = await query<any>(`SELECT COUNT(*)::int AS n FROM "User"`);
  console.log(`\n[commit] ALTER applied. User.formPerms exists: ${after ? 'YES' : 'NO (??)'}`);
  console.log(`Users: ${c[0]?.n ?? '?'} — all start with '{}' (inherit role default).`);
  console.log('DONE.');
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
