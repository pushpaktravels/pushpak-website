// One-shot cleanup: remove the OWNER_IP_ALLOWLIST setting row now
// that the feature has been retired. Idempotent.
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  const r = await pool.query(`DELETE FROM "Setting" WHERE key = 'OWNER_IP_ALLOWLIST'`);
  console.log(`Removed ${r.rowCount ?? 0} OWNER_IP_ALLOWLIST row${(r.rowCount ?? 0) === 1 ? '' : 's'}.`);
  await pool.end();
})();
