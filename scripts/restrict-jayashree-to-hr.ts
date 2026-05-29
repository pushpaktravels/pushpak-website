// One-shot: pin JAYASHREE01's viewPerms to HR-only items so her
// department dropdown shows only "HR" and her sidebar contains only
// Attendance + Employees.
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  const HR_VIEWS = ['attendance', 'employees'];
  const r = await pool.query(
    `UPDATE "User" SET "viewPerms" = $1, "updatedAt" = NOW() WHERE "execId" = 'JAYASHREE01'`,
    [HR_VIEWS]
  );
  if (r.rowCount === 0) { console.error('JAYASHREE01 not found'); process.exit(1); }
  // Audit trail
  const auditId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await pool.query(
    `INSERT INTO "AuditLog" (id, ts, "userId", "execId", action, target, detail, ip, "userAgent")
     VALUES ($1, NOW(), NULL, 'SCRIPT', 'USER_VIEWPERMS_SET', 'JAYASHREE01', $2, NULL, 'restrict-jayashree-to-hr.ts')`,
    [auditId, JSON.stringify({ viewPerms: HR_VIEWS, note: 'HR department only' })]
  );
  console.log(`✓ JAYASHREE01 restricted to HR-only views: [${HR_VIEWS.join(', ')}]`);
  console.log('  Her sidebar dropdown will show "HR" only.');
  await pool.end();
})();
