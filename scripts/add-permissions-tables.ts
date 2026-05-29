// ============================================================
// add-permissions-tables.ts — Department / Module / Permission.
// ============================================================
// Idempotent: re-running is safe. Pure addition — no existing
// tables are modified, no rows seeded. HR work in parallel is
// unaffected.
//
// Schema:
//   Department  — top-level grouping (Accounts, HR, Sales, …)
//   Module      — a feature / page inside a department
//   Permission  — one row per (user, module) granting view|edit|admin
//                 access. No row = none (denied).
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Department" (
      id          TEXT PRIMARY KEY,
      slug        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      color       TEXT,
      icon        TEXT,
      "order"     INT  NOT NULL DEFAULT 0,
      active      BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Module" (
      id             TEXT PRIMARY KEY,
      "departmentId" TEXT NOT NULL REFERENCES "Department"(id) ON DELETE CASCADE,
      slug           TEXT UNIQUE NOT NULL,
      name           TEXT NOT NULL,
      route          TEXT,
      description    TEXT,
      icon           TEXT,
      "order"        INT NOT NULL DEFAULT 0,
      active         BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Module_dept_idx" ON "Module"("departmentId")`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Permission" (
      id          TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL,
      "moduleId"  TEXT NOT NULL REFERENCES "Module"(id) ON DELETE CASCADE,
      level       TEXT NOT NULL CHECK (level IN ('view','edit','admin')),
      scope       JSONB,
      "grantedBy" TEXT NOT NULL,
      "grantedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE ("userId", "moduleId")
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Permission_user_idx"   ON "Permission"("userId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "Permission_module_idx" ON "Permission"("moduleId")`);

  // Count what's present (helpful when re-running)
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "Department") AS departments,
      (SELECT COUNT(*)::int FROM "Module")     AS modules,
      (SELECT COUNT(*)::int FROM "Permission") AS permissions
  `);
  console.log('Permission tables ready.');
  console.log('  Departments :', counts.rows[0].departments);
  console.log('  Modules     :', counts.rows[0].modules);
  console.log('  Permissions :', counts.rows[0].permissions);

  await pool.end();
})();
