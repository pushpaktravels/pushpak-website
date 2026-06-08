// ============================================================
// One-shot migration: Forms/Queries module ("QueryForm" + "Query").
//   QueryForm — owner-editable form definitions (the registry): fields,
//     who may fill (roles + departments), who may view responses, and the
//     recommended classification.
//   Query    — one filled submission: values, submitter, status
//     (open→accepted/rejected), the accounts classification + related
//     account, and an appended remark log. Attachments live in PortalFile
//     (entityType='query'); pushing is DRY-RUN (marks Accepted only).
//
// Seeds the starter forms (Courier, Petrol, Billing for OTP, Vendor Payments)
// from lib/queries.ts — re-running only inserts keys that don't exist yet, so
// it never clobbers owner edits. The OTP form stores no OTP/card number.
// Portal only — never touches FinBook. Idempotent, safe to re-run.
//   npx tsx scripts/add-queries.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';
import { SEED_FORMS } from '../lib/queries';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "QueryForm" (
      id                TEXT PRIMARY KEY,
      key               TEXT NOT NULL UNIQUE,
      title             TEXT NOT NULL,
      description       TEXT,
      fields            JSONB NOT NULL DEFAULT '[]',
      "fillRoles"       TEXT[] NOT NULL DEFAULT '{}',
      "fillDepts"       TEXT[] NOT NULL DEFAULT '{all}',
      "viewRoles"       TEXT[] NOT NULL DEFAULT '{owner,admin,cm-accounts,accounts}',
      "defaultClassify" TEXT,
      active            BOOLEAN NOT NULL DEFAULT TRUE,
      "sortOrder"       INTEGER NOT NULL DEFAULT 0,
      "routeTo"         TEXT,
      "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  // routeTo — added after the table first shipped, so backfill for existing
  // installs. NULL = a generic Query on the accounts desk; 'vendor-payment'
  // routes the submission into the Vendor Payments module instead (the
  // consolidation: one fill place, one tracking place).
  await pool.query(`ALTER TABLE "QueryForm" ADD COLUMN IF NOT EXISTS "routeTo" TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Query" (
      id                   TEXT PRIMARY KEY,
      "formKey"            TEXT NOT NULL,
      "formTitle"          TEXT,
      values               JSONB NOT NULL DEFAULT '{}',
      status               TEXT NOT NULL DEFAULT 'open',
      "classifyType"       TEXT,
      "relatedParty"       TEXT,
      remarks              JSONB NOT NULL DEFAULT '[]',
      "submittedByExecId"  TEXT,
      "submittedByName"    TEXT,
      department           TEXT,
      "reviewedByExecId"   TEXT,
      "reviewedByName"     TEXT,
      "reviewedAt"         TIMESTAMP(3),
      "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Query_formKey_idx" ON "Query" ("formKey")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Query_status_idx" ON "Query" (status)`);

  // Seed starter forms — only if that key doesn't already exist (never clobber
  // owner edits on re-run).
  let seeded = 0;
  for (let i = 0; i < SEED_FORMS.length; i++) {
    const f = SEED_FORMS[i];
    const r = await pool.query(
      `INSERT INTO "QueryForm"
         (id, key, title, description, fields, "fillRoles", "fillDepts", "viewRoles", "defaultClassify", "sortOrder", "routeTo")
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (key) DO NOTHING`,
      [
        `qform_${f.key}`, f.key, f.title, f.description || null, JSON.stringify(f.fields),
        f.fillRoles, f.fillDepts, f.viewRoles, f.defaultClassify, i, f.routeTo || null,
      ],
    );
    seeded += r.rowCount || 0;
    // routeTo is a system routing flag, not an owner-editable field, so keep it
    // in sync even on already-seeded rows (ON CONFLICT skips the INSERT). This
    // never clobbers owner edits to title/fields/permissions.
    if (f.routeTo) {
      await pool.query(
        `UPDATE "QueryForm" SET "routeTo" = $1 WHERE key = $2 AND "routeTo" IS DISTINCT FROM $1`,
        [f.routeTo, f.key],
      );
    }
  }

  console.log(`✓ QueryForm + Query ready (seeded ${seeded} new form${seeded === 1 ? '' : 's'})`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
