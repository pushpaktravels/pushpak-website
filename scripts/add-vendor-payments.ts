// ============================================================
// One-shot migration: create the "VendorPayment" table — the portal
// replacement for the vendor-payment Google Form + its response Excel.
// Idempotent (CREATE TABLE / ADD COLUMN IF NOT EXISTS), safe to re-run.
//
//   npx tsx scripts/add-vendor-payments.ts
//
// An employee raises a payment request against a vendor bill; a manager
// reviews/approves; the payment is recorded; accounts mark it billed. This
// is a portal-only approval ledger — it does NOT touch FinBook (a later
// phase can post the approved payment into FinBook).
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "VendorPayment" (
      "id"               TEXT PRIMARY KEY,
      "vendorName"       TEXT NOT NULL,
      "billNo"           TEXT,
      "amount"           DECIMAL(12,2) NOT NULL DEFAULT 0,
      "purpose"          TEXT,
      "billDate"         TIMESTAMP(3),
      "dueDate"          TIMESTAMP(3),
      "department"       TEXT,
      "status"           TEXT NOT NULL DEFAULT 'requested',
      "requestedByExecId" TEXT,
      "requestedByName"   TEXT,
      "reviewedByExecId"  TEXT,
      "reviewedByName"    TEXT,
      "reviewedAt"        TIMESTAMP(3),
      "reviewNote"        TEXT,
      "paymentMode"       TEXT,
      "paymentRef"        TEXT,
      "paidByExecId"      TEXT,
      "paidByName"        TEXT,
      "paidAt"            TIMESTAMP(3),
      "billedByExecId"    TEXT,
      "billedByName"      TEXT,
      "billedAt"          TIMESTAMP(3),
      "notes"             TEXT,
      "createdBy"         TEXT,
      "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "VendorPayment_status_idx"   ON "VendorPayment" ("status")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "VendorPayment_dueDate_idx"  ON "VendorPayment" ("dueDate")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "VendorPayment_requester_idx" ON "VendorPayment" ("requestedByExecId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "VendorPayment_vendor_idx"   ON "VendorPayment" ("vendorName")`);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'VendorPayment' ORDER BY ordinal_position`
  );
  console.log('VendorPayment columns:', cols.rows.map((x: any) => x.column_name).join(', '));
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "VendorPayment"`);
  console.log('Existing VendorPayment rows:', count.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
