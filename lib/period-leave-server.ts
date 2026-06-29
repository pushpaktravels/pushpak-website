// ============================================================
// lib/period-leave-server.ts — DB-touching helpers for period leave.
// ============================================================
// The pure cycle MATH lives in lib/period-leave.ts (client-safe). This is its
// server-only companion: read an employee's period-leave history, and raise an
// owner notification when a new entry looks off-pattern. Shared by the
// self-service (/api/leave) and HR (/api/attendance/leave-admin) routes so the
// tracking can never drift between the two ways a period leave gets recorded.
// ============================================================
import { query, newId } from '@/lib/pg';

function isoOf(v: any): string {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

// All of an employee's period-leave START dates, ascending ISO.
export async function loadPeriodStarts(employeeId: string): Promise<string[]> {
  const rows = await query<any>(
    `SELECT "fromDate" FROM "LeaveRequest"
      WHERE "employeeId" = $1 AND kind = 'PERIOD_LEAVE'
      ORDER BY "fromDate" ASC`,
    [employeeId],
  );
  return rows.map((r) => isoOf(r.fromDate));
}

// Notify every owner login (role 'owner', plus the pinned VANSHIKA01) that a
// period leave looked off-pattern. kind 'PERIOD_ALERT' lands in the bell and
// routes to Record Leave. Best-effort: a notify failure must NEVER break the
// leave itself, so we swallow + log any error.
export async function notifyOwnersPeriodFlag(
  emp: { name: string; hrCode: string },
  startIso: string,
  reason: string,
): Promise<void> {
  try {
    const owners = await query<any>(
      `SELECT id FROM "User" WHERE active = TRUE AND (role = 'owner' OR "execId" = 'VANSHIKA01')`,
    );
    const title = `Period-leave check — ${emp.name}`;
    const body = `${emp.name} (${emp.hrCode}) recorded period leave starting ${startIso}. ${reason}`.trim();
    for (const o of owners) {
      await query(
        `INSERT INTO "Notification" (id, "userId", kind, title, body, party)
         VALUES ($1, $2, 'PERIOD_ALERT', $3, $4, $5)`,
        [newId('ntf'), o.id, title, body.slice(0, 400), 'period-leave'],
      );
    }
  } catch (e) {
    console.error('[period-leave] owner notify failed', e);
  }
}
