// ============================================================
// attendance-db.ts — shared helpers for the attendance module.
// ============================================================
// Plain functions over a pg query callback (works both inside a
// withTransaction `q` and with the standalone `query`).
// ============================================================
import { newId } from './pg';
import type { BiometricRow } from './attendance-parser';
import { classifyDay, type ClassifyInput, type LeaveKind } from './attendance-classify';

type Q = (sql: string, params?: any[]) => Promise<any[]>;

export type EmployeeRow = {
  id: string;
  machineCode: string | null;
  hrCode: string;
  name: string;
  weeklyOffDay: number;
  shiftIn: string | null;
  shiftOut: string | null;
};

// Indian financial year for a date: Apr 1 → Mar 31. "2026-2027".
export function financialYearOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0=Jan
  return m >= 3 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// Parse "YYYY-MM-DD" into a UTC date (avoids TZ drift on DATE columns).
export function isoToUtcDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Map a Postgres weekday (JS getUTCDay: 0=Sun..6=Sat) for a given ISO date.
export function weekdayOf(iso: string): number {
  return isoToUtcDate(iso).getUTCDay();
}

// Bootstrap-from-biometric: ensure an Employee exists for every machine
// code in the parsed rows. Unknown codes get a stub (hrCode "BIO-<code>",
// salary 0) for the owner to enrich later. Returns machineCode → employee.
export async function ensureEmployees(
  q: Q,
  rows: BiometricRow[],
): Promise<{ byCode: Map<string, EmployeeRow>; created: number }> {
  const existing = await q(`SELECT id, "machineCode", "hrCode", name, "weeklyOffDay", "shiftIn", "shiftOut" FROM "Employee"`);
  const byCode = new Map<string, EmployeeRow>();
  for (const e of existing as EmployeeRow[]) {
    if (e.machineCode) byCode.set(e.machineCode, e);
  }
  const usedHrCodes = new Set((existing as any[]).map((e) => e.hrCode));

  let created = 0;
  for (const r of rows) {
    if (byCode.has(r.machineCode)) continue;
    // pick a unique placeholder hrCode
    let hrCode = `BIO-${r.machineCode}`;
    let n = 1;
    while (usedHrCodes.has(hrCode)) hrCode = `BIO-${r.machineCode}-${n++}`;
    usedHrCodes.add(hrCode);

    const id = newId('emp');
    await q(
      `INSERT INTO "Employee"
        (id, "machineCode", "hrCode", name, department, "shiftIn", "shiftOut", "weeklyOffDay", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,NOW(),NOW())`,
      [id, r.machineCode, hrCode, r.name, r.department, r.scheduledIn, r.scheduledOut],
    );
    const emp: EmployeeRow = {
      id, machineCode: r.machineCode, hrCode, name: r.name,
      weeklyOffDay: 0, shiftIn: r.scheduledIn, shiftOut: r.scheduledOut,
    };
    byCode.set(r.machineCode, emp);
    created++;
  }
  return { byCode, created };
}

// Look up the per-date context the classifier needs: is it a holiday,
// and which employees have an approved leave / on-duty covering the date.
export async function loadDayContext(q: Q, iso: string): Promise<{
  isHoliday: boolean;
  leaveByEmp: Map<string, LeaveKind>;
  onDutyEmps: Set<string>;
}> {
  const hol = await q(`SELECT 1 FROM "Holiday" WHERE date = $1 LIMIT 1`, [iso]);
  const leaves = await q(
    `SELECT "employeeId", kind FROM "LeaveRequest"
      WHERE status = 'APPROVED' AND "fromDate" <= $1 AND "toDate" >= $1`,
    [iso],
  );
  const leaveByEmp = new Map<string, LeaveKind>();
  const onDutyEmps = new Set<string>();
  for (const l of leaves as any[]) {
    if (l.kind === 'ON_DUTY') onDutyEmps.add(l.employeeId);
    else if (l.kind) leaveByEmp.set(l.employeeId, l.kind as LeaveKind);
  }
  return { isHoliday: hol.length > 0, leaveByEmp, onDutyEmps };
}

// Upsert one DailyAttendance row, merging punches with any existing
// record for that (employee, date) and re-classifying. Manual overrides
// are respected: if the existing row is overridden, only punch fields
// are updated, status is left as the human set it.
export async function upsertAttendance(
  q: Q,
  emp: EmployeeRow,
  iso: string,
  row: BiometricRow,
  ctx: { isHoliday: boolean; leaveByEmp: Map<string, LeaveKind>; onDutyEmps: Set<string> },
): Promise<void> {
  const existing = (
    await q(
      `SELECT id, "actualIn", "actualOut", overridden FROM "DailyAttendance"
        WHERE "employeeId" = $1 AND date = $2 LIMIT 1`,
      [emp.id, iso],
    )
  )[0] as { id: string; actualIn: string | null; actualOut: string | null; overridden: boolean } | undefined;

  const actualIn = row.actualIn ?? existing?.actualIn ?? null;
  const actualOut = row.actualOut ?? existing?.actualOut ?? null;

  const isWeeklyOff = weekdayOf(iso) === emp.weeklyOffDay;
  const ci: ClassifyInput = {
    scheduledIn: row.scheduledIn ?? emp.shiftIn,
    scheduledOut: row.scheduledOut ?? emp.shiftOut,
    actualIn,
    actualOut,
    isWeeklyOff,
    isHoliday: ctx.isHoliday,
    leaveKind: ctx.leaveByEmp.get(emp.id) ?? null,
    onDuty: ctx.onDutyEmps.has(emp.id),
  };
  const c = classifyDay(ci);

  if (existing) {
    if (existing.overridden) {
      // keep human status; just refresh punch data + machine refs
      await q(
        `UPDATE "DailyAttendance" SET
           "actualIn" = $1, "actualOut" = $2, "machineCode" = $3,
           "scheduledIn" = $4, "scheduledOut" = $5,
           "workDurMin" = $6, "updatedAt" = NOW()
         WHERE id = $7`,
        [actualIn, actualOut, row.machineCode, ci.scheduledIn, ci.scheduledOut, row.workDurMin, existing.id],
      );
    } else {
      await q(
        `UPDATE "DailyAttendance" SET
           "machineCode" = $1, "scheduledIn" = $2, "scheduledOut" = $3,
           "actualIn" = $4, "actualOut" = $5,
           "lateByMin" = $6, "earlyGoingMin" = $7, "workDurMin" = $8,
           status = $9, "isInformed" = FALSE, "deductionDays" = $10,
           remark = $11, source = 'biometric', "updatedAt" = NOW()
         WHERE id = $12`,
        [row.machineCode, ci.scheduledIn, ci.scheduledOut, actualIn, actualOut,
         c.lateByMin, c.earlyGoingMin, row.workDurMin, c.status, c.rawDeductionDays,
         c.remark, existing.id],
      );
    }
  } else {
    await q(
      `INSERT INTO "DailyAttendance"
        (id, "employeeId", "machineCode", date, "scheduledIn", "scheduledOut",
         "actualIn", "actualOut", "lateByMin", "earlyGoingMin", "workDurMin",
         status, "isInformed", "deductionDays", remark, source, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,$13,$14,'biometric',NOW(),NOW())`,
      [newId('att'), emp.id, row.machineCode, iso, ci.scheduledIn, ci.scheduledOut,
       actualIn, actualOut, c.lateByMin, c.earlyGoingMin, row.workDurMin,
       c.status, c.rawDeductionDays, c.remark],
    );
  }
}
