// ============================================================
// One-shot: migrate User.role from Postgres enum to free-text
// and remap legacy values to the new role taxonomy.
// ============================================================
// Before: enum Role { owner, admin, cm, exec, analyst }
// After:  role TEXT NOT NULL DEFAULT 'accounts'
//
// Value remap:
//   cm       → cm-accounts
//   exec     → domestic-reservations   (owner will reassign later)
//   analyst  → insights
//   owner    → owner   (no change)
//   admin    → admin   (no change)
//
// Writes one AuditLog row per migrated user so the change is
// reviewable, plus a summary row. Idempotent — running it twice
// is safe (the enum is already gone after the first run; values
// are already remapped).
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const REMAP: Record<string, string> = {
  cm: 'cm-accounts',
  exec: 'domestic-reservations',
  analyst: 'insights',
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) If the column is still the enum type, convert it to text.
    const colType = await client.query<{ data_type: string; udt_name: string }>(
      `SELECT data_type, udt_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'role'`
    );
    const isEnum = colType.rows[0]?.data_type === 'USER-DEFINED';
    if (isEnum) {
      console.log('• Converting "User".role from enum → text …');
      await client.query(`ALTER TABLE "User" ALTER COLUMN role DROP DEFAULT`);
      await client.query(`ALTER TABLE "User" ALTER COLUMN role TYPE text USING role::text`);
      await client.query(`ALTER TABLE "User" ALTER COLUMN role SET DEFAULT 'accounts'`);
    } else {
      console.log('• Column "User".role is already text — skipping type conversion.');
    }

    // 2) Remap legacy role strings.
    const users = await client.query<{ id: string; execId: string; role: string }>(
      `SELECT id, "execId", role FROM "User" WHERE role IN ($1, $2, $3)`,
      ['cm', 'exec', 'analyst']
    );
    console.log(`• Found ${users.rows.length} user(s) with legacy roles.`);

    for (const u of users.rows) {
      const next = REMAP[u.role];
      if (!next) continue;
      await client.query(
        `UPDATE "User" SET role = $1, "updatedAt" = NOW() WHERE id = $2`,
        [next, u.id]
      );
      const auditId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await client.query(
        `INSERT INTO "AuditLog" (id, ts, "userId", "execId", action, target, detail, ip, "userAgent")
         VALUES ($1, NOW(), NULL, 'SCRIPT', 'USER_ROLE_REMAP', $2, $3, NULL, 'migrate-roles-2026-05-29.ts')`,
        [auditId, u.execId, JSON.stringify({ from: u.role, to: next })]
      );
      console.log(`  ${u.execId}: ${u.role} → ${next}`);
    }

    // 3) Drop the old enum type if it still exists and nothing references it.
    const enumExists = await client.query(
      `SELECT 1 FROM pg_type WHERE typname = 'Role'`
    );
    if (enumExists.rowCount && enumExists.rowCount > 0) {
      const refs = await client.query<{ refs: string }>(
        `SELECT COUNT(*)::text AS refs
           FROM information_schema.columns
          WHERE udt_name = 'Role' AND table_schema = 'public'`
      );
      if (Number(refs.rows[0]?.refs || 0) === 0) {
        console.log('• Dropping unused enum type "Role" …');
        await client.query(`DROP TYPE "Role"`);
      } else {
        console.log('• Enum "Role" still referenced by some column — leaving it in place.');
      }
    }

    // 4) Summary audit row.
    const sumId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await client.query(
      `INSERT INTO "AuditLog" (id, ts, "userId", "execId", action, target, detail, ip, "userAgent")
       VALUES ($1, NOW(), NULL, 'SCRIPT', 'ROLE_TAXONOMY_MIGRATED', 'User', $2, NULL, 'migrate-roles-2026-05-29.ts')`,
      [sumId, JSON.stringify({
        remap: REMAP,
        migratedCount: users.rows.length,
        droppedEnum: enumExists.rowCount && enumExists.rowCount > 0,
      })]
    );

    await client.query('COMMIT');
    console.log('✓ Role migration complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ Migration failed:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
