// Idempotent: Conversation + ConversationParticipant + Message tables for the
// in-portal exec chat, plus a Notification.convId column so a "new message"
// notification can deep-link to its thread.
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Conversation" (
      id              TEXT PRIMARY KEY,
      "isGroup"       BOOLEAN NOT NULL DEFAULT false,
      title           TEXT,
      "dmKey"         TEXT UNIQUE,
      "createdBy"     TEXT NOT NULL,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "lastMessageAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt" DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "ConversationParticipant" (
      id               TEXT PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "userId"         TEXT NOT NULL,
      "lastReadAt"     TIMESTAMP,
      "addedAt"        TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "ConversationParticipant_conv_user_idx" ON "ConversationParticipant"("conversationId","userId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ConversationParticipant_user_idx" ON "ConversationParticipant"("userId")`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Message" (
      id               TEXT PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "senderId"       TEXT NOT NULL,
      body             TEXT NOT NULL,
      "createdAt"      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Message_conv_created_idx" ON "Message"("conversationId","createdAt")`);

  // Deep-link target for "new message" notifications (existing table).
  await pool.query(`ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "convId" TEXT`);

  console.log('Chat tables ready (Conversation, ConversationParticipant, Message) + Notification.convId.');
  await pool.end();
})();
