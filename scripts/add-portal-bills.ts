// ============================================================
// One-shot migration: the "PortalBill" outbox — the durable record of every
// attempt to turn a portal booking into a FinBook sales bill (Phase 3).
//
// Why an outbox, not a fire-and-forget call: billing MUST be auditable and
// idempotent. Each row stores the exact payload we built, FinBook's response
// (or the error), the mode it ran in, and a UNIQUE refKey derived from the
// source booking — so the same booking can never be billed twice, and we can
// retry a failure or void a mistake with a full paper trail.
//
// In dry-run the rows are real (status 'simulated'); only the FinBook call is
// faked. Flipping FINBOOK_MODE=live later makes the very same flow post for
// real. Idempotent DDL, safe to re-run.
//   npx tsx scripts/add-portal-bills.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "PortalBill" (
      "id"                TEXT PRIMARY KEY,
      "source"            TEXT NOT NULL DEFAULT 'reservation',  -- what produced it
      "sourceId"          TEXT NOT NULL,                        -- the Reservation id
      "refKey"            TEXT NOT NULL,                        -- idempotency / cross-ref
      "clientId"          TEXT,                                 -- FinBook ledger billed
      "clientWebId"       TEXT,
      "clientLabel"       TEXT,
      "serviceCode"       TEXT,                                 -- I=air, B=bus …
      "amount"            DECIMAL(12,2) NOT NULL DEFAULT 0,
      "docPrefix"         TEXT,                                 -- voucher series (IW)
      "docNo"             TEXT,                                 -- FinBook document no
      "status"            TEXT NOT NULL DEFAULT 'simulated',    -- simulated|posted|failed|void
      "mode"              TEXT NOT NULL DEFAULT 'dryrun',       -- dryrun|live (at time of run)
      "simulated"         BOOLEAN NOT NULL DEFAULT TRUE,
      "payload"           JSONB,                                -- exact body we built
      "response"          JSONB,                                -- FinBook response / sim
      "error"             TEXT,
      "generatedByExecId" TEXT,
      "generatedByName"   TEXT,
      "postedAt"          TIMESTAMP(3),
      "voidedByName"      TEXT,
      "voidedAt"          TIMESTAMP(3),
      "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  // One live/simulated bill per refKey — the heart of double-bill safety.
  // (Voided rows keep the refKey; a retry upserts the same row.)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "PortalBill_refKey_uidx" ON "PortalBill" ("refKey")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "PortalBill_source_idx" ON "PortalBill" ("source", "sourceId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "PortalBill_status_idx" ON "PortalBill" ("status")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "PortalBill_created_idx" ON "PortalBill" ("createdAt")`);

  const n = await pool.query(`SELECT COUNT(*)::int AS n FROM "PortalBill"`);
  console.log('PortalBill rows:', n.rows[0].n);

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
