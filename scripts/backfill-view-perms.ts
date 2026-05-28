// One-shot: append newly-introduced view keys to every active user's
// viewPerms list, but only the ones their role is supposed to see.
// Owner is handled in code now (bypasses viewPerms), but admins,
// CMs, execs, analysts still rely on the array.
//
// Idempotent: keys already present are skipped.
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

// Map each newly-added sidebar view key → which roles should get it
// automatically appended.
const NEW_VIEWS: Array<{ view: string; roles: string[] }> = [
  { view: 'bulk-cm',  roles: ['admin'] },                     // CMs already see via team-worklist
  { view: 'audit',    roles: [] },                            // owner-only, handled in code
  { view: 'activity', roles: ['admin'] },                     // owner-only otherwise
  { view: 'upload',   roles: ['admin'] },                     // covers folks who joined post-upload
];

(async () => {
  const users = await pool.query<any>(
    `SELECT id, name, role, "viewPerms" FROM "User"
      WHERE active = true AND role <> 'owner'`
  );
  let touched = 0;
  for (const u of users.rows) {
    if (!u.viewPerms || u.viewPerms.length === 0) continue;  // unrestricted — sees role defaults
    const next = new Set<string>(u.viewPerms);
    let changed = false;
    for (const nv of NEW_VIEWS) {
      if (nv.roles.includes(u.role) && !next.has(nv.view)) {
        next.add(nv.view);
        changed = true;
      }
    }
    if (changed) {
      await pool.query(
        `UPDATE "User" SET "viewPerms" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [Array.from(next), u.id]
      );
      console.log(`  ${u.name} (${u.role}): added ${Array.from(next).filter(v => !u.viewPerms.includes(v)).join(', ')}`);
      touched++;
    }
  }
  console.log(`\n✓ Updated viewPerms on ${touched} user${touched === 1 ? '' : 's'}.`);
  await pool.end();
})();
