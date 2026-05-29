// ============================================================
// One-shot migration: create the "Reservation" table for the new
// Domestic Reservations department. Idempotent (CREATE TABLE IF NOT
// EXISTS + ADD COLUMN IF NOT EXISTS), so it's safe to re-run.
//
//   npx tsx scripts/add-reservations.ts
//
// Stand-alone booking store (not linked to Account/Client yet):
//   • passengerName / paxCount / contact — who is travelling
//   • sector / airline / travelDate       — the itinerary
//   • fareAmount / amountCollected        — money (due = fare − collected)
//   • vendor / pnr / status               — fulfilment (Held|Ticketed|Cancelled)
//   • agentExecId / agentName             — owning agent (drives My Worklist)
//
// Mirrors the Prisma model in prisma/schema.prisma. Runtime access is
// via node-postgres (lib/pg), so this raw DDL is the source of truth
// for the live table shape.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Reservation" (
      "id"              TEXT PRIMARY KEY,
      "pnr"             TEXT,
      "passengerName"   TEXT NOT NULL,
      "paxCount"        INTEGER NOT NULL DEFAULT 1,
      "contact"         TEXT,
      "sector"          TEXT NOT NULL,
      "airline"         TEXT,
      "travelDate"      TIMESTAMP(3),
      "fareAmount"      DECIMAL(12,2) NOT NULL DEFAULT 0,
      "amountCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "vendor"          TEXT,
      "status"          TEXT NOT NULL DEFAULT 'Held',
      "notes"           TEXT,
      "agentExecId"     TEXT,
      "agentName"       TEXT,
      "createdBy"       TEXT,
      "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);

  // Indexes the list / dues / worklist queries hit.
  await pool.query(`CREATE INDEX IF NOT EXISTS "Reservation_status_idx"      ON "Reservation" ("status")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Reservation_travelDate_idx"  ON "Reservation" ("travelDate")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Reservation_agentExecId_idx" ON "Reservation" ("agentExecId")`);

  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'Reservation'
     ORDER BY ordinal_position
  `);
  console.log('Reservation columns:', cols.rows.map((x: any) => x.column_name).join(', '));

  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "Reservation"`);
  console.log('Existing reservations:', count.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
