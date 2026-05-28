// ActivityDay — one row per (userId, date) accumulating active seconds
// + a per-page breakdown JSON. Updated by /api/activity/ping in an
// UPSERT so we never have to manage stitching sessions.
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "ActivityDay" (
      "userId"        TEXT NOT NULL,
      date            DATE NOT NULL,
      "activeSec"     INT  NOT NULL DEFAULT 0,
      "lastPingAt"    TIMESTAMP,
      "lastPage"      TEXT,
      "pageBreakdown" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "execId"        TEXT,
      "userName"      TEXT,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("userId", date)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ActivityDay_date_idx" ON "ActivityDay"(date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ActivityDay_lastPing_idx" ON "ActivityDay"("lastPingAt")`);
  console.log('ActivityDay table ready.');
  await pool.end();
})();
