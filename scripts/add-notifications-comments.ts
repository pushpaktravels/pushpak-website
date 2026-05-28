// Idempotent: Notification + Comment tables.
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Notification" (
      id        TEXT PRIMARY KEY,
      ts        TIMESTAMP NOT NULL DEFAULT NOW(),
      "userId"  TEXT NOT NULL,
      kind      TEXT NOT NULL,
      title     TEXT NOT NULL,
      body      TEXT,
      party     TEXT,
      "accountId" TEXT,
      "readAt"  TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Notification_user_ts_idx" ON "Notification"("userId", ts DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Notification_unread_idx" ON "Notification"("userId") WHERE "readAt" IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Comment" (
      id          TEXT PRIMARY KEY,
      ts          TIMESTAMP NOT NULL DEFAULT NOW(),
      party       TEXT NOT NULL,
      "userId"    TEXT,
      "execId"    TEXT,
      "userName"  TEXT NOT NULL,
      body        TEXT NOT NULL,
      mentions    TEXT[] DEFAULT ARRAY[]::TEXT[]
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Comment_party_ts_idx" ON "Comment"(party, ts DESC)`);

  console.log('Notification + Comment tables ready.');
  await pool.end();
})();
