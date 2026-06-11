// ============================================================
// One-shot migration: add "party" (the account the booking is billed to) to
// "Reservation". This is the client-master link — separate from
// "passengerName" (the traveller, still free-typed). The booking form pre-fills
// the account from the client master and leaves only the passenger name manual.
// Idempotent (ADD COLUMN IF NOT EXISTS), safe to re-run; existing rows get NULL.
//
//   npx tsx scripts/add-reservation-party.ts
//
// 'party' loosely references Account.party by name (no FK — a brand-new client
// created at booking time may not be in the Account snapshot yet; a later
// FinBook upload reconciles by party name via the existing ON CONFLICT upsert).
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "party" TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Reservation_party_idx" ON "Reservation" ("party")`);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Reservation' ORDER BY ordinal_position`
  );
  console.log('Reservation columns:', cols.rows.map((x: any) => x.column_name).join(', '));

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
