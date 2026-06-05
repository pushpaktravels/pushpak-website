// ============================================================
// One-shot migration: in-portal attachment store ("PortalFile").
//   A single polymorphic table that holds uploaded files (bill scans,
//   payment receipts, query attachments) AS BYTES, inside our own
//   Postgres — so accounts can open them in the portal with no Google
//   Drive / external-storage permission to juggle, and access is gated
//   by the same view that owns the parent record.
//
//   entityType+entityId point back at the owning row, e.g.
//     ('vendor-payment', '<vpay id>')  → a bill / receipt
//     ('query',          '<query id>') → a query attachment (item 5)
//
// Portal only — does NOT touch FinBook. Idempotent, safe to re-run.
//   npx tsx scripts/add-portal-files.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "PortalFile" (
      id                 TEXT PRIMARY KEY,
      "entityType"       TEXT NOT NULL,
      "entityId"         TEXT NOT NULL,
      kind               TEXT,                 -- 'bill' | 'receipt' | 'attachment'
      "fileName"         TEXT NOT NULL,
      "mimeType"         TEXT NOT NULL,
      size               INTEGER NOT NULL DEFAULT 0,
      content            BYTEA NOT NULL,
      "uploadedByExecId" TEXT,
      "uploadedByName"   TEXT,
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  // Look up every file hanging off one parent record in one shot.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "PortalFile_entity_idx" ON "PortalFile" ("entityType", "entityId")`,
  );
  console.log('✓ PortalFile ready');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
