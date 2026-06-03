// ============================================================
// One-shot migration: create the "CardBooking" table — the portal
// replacement for the credit-card OTP Google Form + its response Excel.
// Idempotent (CREATE TABLE / ADD COLUMN IF NOT EXISTS), safe to re-run.
//
//   npx tsx scripts/add-card-bookings.ts
//
// A booker (e.g. Dhiren) logs every credit-card payment here right after
// booking — which card, amount, what it was for, PNR/passenger. Accounts
// (Nigar) then works the "unbilled" list and marks each one billed once the
// invoice is raised. This is a portal-only ledger of card spend; it does
// NOT touch FinBook (later phases can feed these into auto-billing).
//
// We intentionally store NO OTP and NO full card number — only which of the
// firm's cards was used (cardKey) — so nothing sensitive lives here.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CardBooking" (
      "id"             TEXT PRIMARY KEY,
      "cardKey"        TEXT NOT NULL,
      "amount"         DECIMAL(12,2) NOT NULL DEFAULT 0,
      "purpose"        TEXT NOT NULL DEFAULT 'ticket',
      "passengerName"  TEXT,
      "pnr"            TEXT,
      "airline"        TEXT,
      "clientName"     TEXT,
      "department"     TEXT,
      "txnDate"        TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "status"         TEXT NOT NULL DEFAULT 'unbilled',
      "bookedByExecId" TEXT,
      "bookedByName"   TEXT,
      "billedByExecId" TEXT,
      "billedByName"   TEXT,
      "billedAt"       TIMESTAMP(3),
      "notes"          TEXT,
      "createdBy"      TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "CardBooking_cardKey_idx" ON "CardBooking" ("cardKey")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "CardBooking_status_idx"  ON "CardBooking" ("status")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "CardBooking_txnDate_idx" ON "CardBooking" ("txnDate")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "CardBooking_booker_idx"  ON "CardBooking" ("bookedByExecId")`);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'CardBooking' ORDER BY ordinal_position`
  );
  console.log('CardBooking columns:', cols.rows.map((x: any) => x.column_name).join(', '));
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "CardBooking"`);
  console.log('Existing CardBooking rows:', count.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
