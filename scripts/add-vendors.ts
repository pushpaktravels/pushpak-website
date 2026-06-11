// ============================================================
// One-shot migration: create the "Vendor" master table + seed it from the
// list that previously lived hard-coded in the Vendor Payments form.
// Idempotent (CREATE TABLE / INSERT ... ON CONFLICT DO NOTHING), safe to
// re-run — it never overwrites a vendor the desk has since edited.
//
//   npx tsx scripts/add-vendors.ts
//
// Why a table and not just the form options: vendors now need to be searched
// and reused on bookings / vendor payments, and the desk must be able to add a
// new one without a code change. Portal-only; nothing here touches FinBook.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';
import { SEED_VENDORS } from '../lib/vendors';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Vendor" (
      "id"         TEXT PRIMARY KEY,
      "name"       TEXT NOT NULL,
      "contact"    TEXT,
      "gstin"      TEXT,
      "notes"      TEXT,
      "active"     BOOLEAN NOT NULL DEFAULT TRUE,
      "createdBy"  TEXT,
      "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  // Case-insensitive uniqueness on name so "Airtel" and "AIRTEL" can't both be
  // added; the picker's add-new check relies on this.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_name_lower_key" ON "Vendor" (LOWER("name"))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Vendor_active_idx" ON "Vendor" ("active")`);

  // Seed the original list. ON CONFLICT against the lower(name) index keeps it
  // idempotent without disturbing edited rows.
  let seeded = 0;
  for (const name of SEED_VENDORS) {
    const r = await pool.query(
      `INSERT INTO "Vendor" (id, name, "createdBy", "createdAt", "updatedAt")
       VALUES ($1, $2, 'seed', NOW(), NOW())
       ON CONFLICT (LOWER("name")) DO NOTHING`,
      [newId('vnd'), name],
    );
    seeded += r.rowCount || 0;
  }

  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "Vendor"`);
  console.log(`Vendor table ready — seeded ${seeded} new, ${count.rows[0].n} total.`);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
