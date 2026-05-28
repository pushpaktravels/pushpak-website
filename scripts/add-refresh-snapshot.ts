// ============================================================
// add-refresh-snapshot.ts — create RefreshSnapshot table + backfill.
// ============================================================
// One-shot idempotent migration:
//   • CREATE TABLE IF NOT EXISTS "RefreshSnapshot" with aging columns
//   • Backfills one snapshot row per existing RefreshLog entry where
//     we don't already have one (uses the RefreshLog's ts + total).
//     Aging-bucket columns are zero for backfilled rows since we
//     didn't capture them at the time — future snapshots get the full
//     breakdown. The trend chart can still render whatever data exists.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "RefreshSnapshot" (
      id            TEXT PRIMARY KEY,
      ts            TIMESTAMP NOT NULL DEFAULT NOW(),
      "byWhom"      TEXT NOT NULL,
      "accountCount" INT NOT NULL DEFAULT 0,
      total         NUMERIC(14, 2) NOT NULL DEFAULT 0,
      d30           NUMERIC(14, 2) NOT NULL DEFAULT 0,
      d60           NUMERIC(14, 2) NOT NULL DEFAULT 0,
      d90           NUMERIC(14, 2) NOT NULL DEFAULT 0,
      d90p          NUMERIC(14, 2) NOT NULL DEFAULT 0,
      "activeHolds" INT NOT NULL DEFAULT 0,
      "candidates"  INT NOT NULL DEFAULT 0,
      "refreshLogId" TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "RefreshSnapshot_ts_idx" ON "RefreshSnapshot"(ts)`);

  // Backfill: one snapshot per RefreshLog row that doesn't already have one.
  // Use the RefreshLog id as refreshLogId so the join is unique.
  const r = await pool.query(`
    INSERT INTO "RefreshSnapshot" (id, ts, "byWhom", "accountCount", total, "refreshLogId")
    SELECT
      'snap_' || rl.id,
      rl.ts,
      rl."byWhom",
      rl."accountCount",
      rl."totalOutstanding",
      rl.id
    FROM "RefreshLog" rl
    LEFT JOIN "RefreshSnapshot" rs ON rs."refreshLogId" = rl.id
    WHERE rs.id IS NULL
    RETURNING id
  `);
  console.log(`Backfilled ${r.rowCount} snapshot row${r.rowCount === 1 ? '' : 's'} from RefreshLog.`);

  // Also capture today's aging breakdown so we have a "current" datapoint
  // alongside the backfilled total-only rows.
  const today = await pool.query<any>(
    `SELECT COALESCE(SUM(bill),0)::float8  AS total,
            COUNT(*)::int                  AS accounts,
            COALESCE(SUM(d30),0)::float8   AS d30,
            COALESCE(SUM(d60),0)::float8   AS d60,
            COALESCE(SUM(d90),0)::float8   AS d90,
            COALESCE(SUM(d90p),0)::float8  AS d90p,
            SUM(CASE WHEN "onHold" = 'Active'    THEN 1 ELSE 0 END)::int AS active_holds,
            SUM(CASE WHEN "onHold" = 'Candidate' THEN 1 ELSE 0 END)::int AS candidates
       FROM "Account"`
  );
  const t = today.rows[0];
  await pool.query(
    `INSERT INTO "RefreshSnapshot"
       (id, ts, "byWhom", "accountCount", total, d30, d60, d90, d90p, "activeHolds", "candidates")
     VALUES ($1, NOW(), 'BACKFILL', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [`snap_${Date.now().toString(36)}_seed`,
     t.accounts, t.total, t.d30, t.d60, t.d90, t.d90p, t.active_holds, t.candidates]
  );
  console.log(`Inserted today's full-detail snapshot:`);
  console.log(`  ${t.accounts} accounts · ₹${Number(t.total).toLocaleString('en-IN')} total`);
  console.log(`  0-30: ₹${Number(t.d30).toLocaleString('en-IN')} · 31-60: ₹${Number(t.d60).toLocaleString('en-IN')}`);
  console.log(`  61-90: ₹${Number(t.d90).toLocaleString('en-IN')} · 90+: ₹${Number(t.d90p).toLocaleString('en-IN')}`);

  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "RefreshSnapshot"`);
  console.log(`\nRefreshSnapshot total rows: ${count.rows[0].n}`);

  await pool.end();
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
