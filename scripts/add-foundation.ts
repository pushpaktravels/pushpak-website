// ============================================================
// One-shot migration: create the shared-foundation tables — "Task"
// (universal task / reminder engine) and "Lead" (cross-department
// pipeline). Idempotent (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF
// NOT EXISTS), so it's safe to re-run.
//
//   npx tsx scripts/add-foundation.ts
//
// Every department links through these two primitives instead of
// reinventing tasks/reminders and lead capture:
//   • Task — reservation hold-clock, travel reminders, visa
//            appointments, package vouchers, lead follow-ups. Polymorphic
//            link (relatedType + relatedId) to the record it's about.
//   • Lead — captured anywhere, routed to a department, and on WIN
//            converted into that department's record (convertedType +
//            convertedId). This is the Marketing → dept seam.
//
// Mirrors the Prisma models in prisma/schema.prisma. Runtime access is
// via node-postgres (lib/pg), so this raw DDL is the source of truth
// for the live table shape.
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  // ── Task ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Task" (
      "id"             TEXT PRIMARY KEY,
      "kind"           TEXT NOT NULL DEFAULT 'generic',
      "title"          TEXT NOT NULL,
      "details"        TEXT,
      "department"     TEXT,
      "status"         TEXT NOT NULL DEFAULT 'open',
      "priority"       TEXT NOT NULL DEFAULT 'normal',
      "dueAt"          TIMESTAMP(3),
      "remindAt"       TIMESTAMP(3),
      "snoozedUntil"   TIMESTAMP(3),
      "assigneeExecId" TEXT,
      "assigneeName"   TEXT,
      "createdBy"      TEXT,
      "relatedType"    TEXT,
      "relatedId"      TEXT,
      "relatedLabel"   TEXT,
      "meta"           JSONB,
      "doneAt"         TIMESTAMP(3),
      "doneBy"         TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Task_status_idx"       ON "Task" ("status")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Task_dueAt_idx"        ON "Task" ("dueAt")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Task_remindAt_idx"     ON "Task" ("remindAt")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Task_assignee_idx"     ON "Task" ("assigneeExecId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Task_department_idx"   ON "Task" ("department")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Task_related_idx"      ON "Task" ("relatedType", "relatedId")`);

  // ── Lead ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Lead" (
      "id"             TEXT PRIMARY KEY,
      "name"           TEXT NOT NULL,
      "contact"        TEXT,
      "email"          TEXT,
      "source"         TEXT NOT NULL DEFAULT 'other',
      "department"     TEXT,
      "stage"          TEXT NOT NULL DEFAULT 'new',
      "priority"       TEXT NOT NULL DEFAULT 'normal',
      "assigneeExecId" TEXT,
      "assigneeName"   TEXT,
      "estValue"       DECIMAL(12,2),
      "notes"          TEXT,
      "lostReason"     TEXT,
      "convertedType"  TEXT,
      "convertedId"    TEXT,
      "createdBy"      TEXT,
      "lastActivityAt" TIMESTAMP(3),
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Lead_stage_idx"      ON "Lead" ("stage")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Lead_department_idx" ON "Lead" ("department")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Lead_assignee_idx"   ON "Lead" ("assigneeExecId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Lead_source_idx"     ON "Lead" ("source")`);

  for (const t of ['Task', 'Lead']) {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [t]
    );
    console.log(`${t} columns:`, cols.rows.map((x: any) => x.column_name).join(', '));
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(`Existing ${t} rows:`, count.rows[0].n);
  }

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
