// ============================================================
// One-shot migration: add the deepening fields to "Reservation" —
// costAmount + refundAmount (margin & refund tracking) and holdUntil
// (the ticketing-deadline that drives the hold-clock reminder Task).
// Idempotent (ADD COLUMN IF NOT EXISTS), so it's safe to re-run and it
// leaves existing rows untouched (new money columns default to 0).
//
//   npx tsx scripts/add-reservation-fields.ts
//
// Mirrors the additions to the Reservation model in
// prisma/schema.prisma. The hold-clock reminder is wired in
// lib/reservations.ts (kind 'reservation_hold').
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "costAmount"   DECIMAL(12,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "holdUntil"    TIMESTAMP(3)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Reservation_holdUntil_idx" ON "Reservation" ("holdUntil")`);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Reservation' ORDER BY ordinal_position`
  );
  console.log('Reservation columns:', cols.rows.map((x: any) => x.column_name).join(', '));
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "Reservation"`);
  console.log('Existing Reservation rows:', count.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
