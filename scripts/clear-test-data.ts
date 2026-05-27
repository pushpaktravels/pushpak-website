// ============================================================
// clear-test-data.ts — wipe every TEST_* / "TEST ..." row.
// ============================================================
// One-shot cleanup so real FinBook data can be uploaded into a
// clean slate. Mirrors the delete block at the top of
// seed-test-accounts.ts (same FK-safe order). Safe to re-run.
//
// Run with:
//   npx tsx scripts/clear-test-data.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

async function main() {
  console.log('Connecting to', (process.env.DIRECT_URL || process.env.DATABASE_URL || '').replace(/:([^:@]+)@/, ':***@'));
  console.log('Clearing all TEST_* / "TEST ..." rows...\n');

  const steps: Array<[string, string]> = [
    // Child tables first so FK references to PaymentPlan / Account hold up.
    [`"PointEvent"`,     `DELETE FROM "PointEvent"     WHERE (party LIKE 'TEST %' OR id LIKE 'TEST_%')`],
    [`"CollectionLog"`,  `DELETE FROM "CollectionLog"  WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"LegalCase"`,      `DELETE FROM "LegalCase"      WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"PlanInstalment"`, `DELETE FROM "PlanInstalment" WHERE "planId" LIKE 'TEST_%' OR id LIKE 'TEST_%'`],
    [`"PaymentPlan"`,    `DELETE FROM "PaymentPlan"    WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"AccountHistory"`, `DELETE FROM "AccountHistory" WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"HoldRecord"`,     `DELETE FROM "HoldRecord"     WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"Promise"`,        `DELETE FROM "Promise"        WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"ClientMaster"`,   `DELETE FROM "ClientMaster"   WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"Account"`,        `DELETE FROM "Account"        WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`],
    [`"RefreshToken"`,   `DELETE FROM "RefreshToken"   WHERE "userId" LIKE 'TEST_user_%'`],
    [`"User"`,           `DELETE FROM "User"           WHERE id LIKE 'TEST_user_%'`],
  ];

  let grandTotal = 0;
  for (const [label, sql] of steps) {
    const r = await pool.query(sql);
    const n = r.rowCount || 0;
    grandTotal += n;
    console.log(`  ${label.padEnd(20)} — ${n} row${n === 1 ? '' : 's'} deleted`);
  }

  console.log(`\n✓ Done. ${grandTotal} test rows removed.`);
  console.log('The database is clean. Upload the real FinBook XLS via /portal/upload.');

  await pool.end();
}

main().catch(err => { console.error('Cleanup failed:', err); process.exit(1); });
