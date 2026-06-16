// ============================================================
// attendance-db.ts — shared helpers for the attendance module.
// ============================================================
// Plain functions over a pg query callback (works both inside a
// withTransaction `q` and with the standalone `query`).
// ============================================================
import { newId } from './pg';
import type { BiometricRow } from './attendance-parser';
import { classifyDay, type ClassifyInput, type LeaveKind } from './attendance-classify';
import { leaveEffect, type LeaveKindSS } from './leave';

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

export type DayContext = {
  isHoliday: boolean;
  leaveByEmp: Map<string, LeaveKind>;
  onDutyEmps: Set<string>;
  // Self-service partial-day declarations (lib/leave): half-day / late / early.
  // These don't make the classifier think the whole day is a leave — they are
  // applied AFTER classification to flag the day informed (and, for half days,
  // set the half-day status). Keyed employeeId → leave kind.
  declByEmp: Map<string, LeaveKindSS>;
};

// Look up the per-date context the classifier needs: is it a holiday, who has
// time off covering the date, and how. Two leave vocabularies coexist:
//   • legacy/classifier kinds (PAID_FROM_BALANCE / SPECIAL_PAID / LWP / ON_DUTY)
//   • self-service kinds (FULL_DAY / HALF_DAY / LATE_ARRIVAL / EARLY_OUT)
// FULL_DAY is normalised to a full-day leave; the partial kinds go to declByEmp.
export async function loadDayContext(q: Q, iso: string): Promise<DayContext> {
  const hol = await q(`SELECT 1 FROM "Holiday" WHERE date = $1 LIMIT 1`, [iso]);
  const leaves = await q(
    `SELECT "employeeId", kind FROM "LeaveRequest"
      WHERE status = 'APPROVED' AND "fromDate" <= $1 AND "toDate" >= $1`,
    [iso],
  );
  const leaveByEmp = new Map<string, LeaveKind>();
  const onDutyEmps = new Set<string>();
  const declByEmp = new Map<string, LeaveKindSS>();
  for (const l of leaves as any[]) {
    const kind = l.kind as string | null;
    if (!kind) continue;
    if (kind === 'ON_DUTY') onDutyEmps.add(l.employeeId);
    else if (kind === 'FULL_DAY') leaveByEmp.set(l.employeeId, 'PAID_FROM_BALANCE');
    else if (kind === 'HALF_DAY' || kind === 'LATE_ARRIVAL' || kind === 'EARLY_OUT') {
      declByEmp.set(l.employeeId, kind as LeaveKindSS);
    } else {
      // legacy classifier vocabulary (PAID_FROM_BALANCE / SPECIAL_PAID / LWP)
      leaveByEmp.set(l.employeeId, kind as LeaveKind);
    }
  }
  return { isHoliday: hol.length > 0, leaveByEmp, onDutyEmps, declByEmp };
}

// Reflect a freshly-declared leave onto any DailyAttendance rows that ALREADY
// exist in the range (e.g. today's punches were uploaded before the person
// declared). Human overrides (overridden = TRUE) are never touched. Future
// dates with no row yet are handled at upload time via loadDayContext.
// Returns how many day-rows were updated. Pass kind === null to REVERT a
// cancelled declaration (clear the informed flag; re-classification on the
// next upload restores the true biometric status).
export async function applyDeclarationToDays(
  q: Q,
  employeeId: string,
  fromIso: string,
  toIso: string,
  kind: LeaveKindSS | null,
): Promise<number> {
  if (kind === null) {
    const r = await q(
      `UPDATE "DailyAttendance" SET "isInformed" = FALSE, "updatedAt" = NOW()
        WHERE "employeeId" = $1 AND date >= $2 AND date <= $3 AND overridden = FALSE`,
      [employeeId, fromIso, toIso],
    );
    return (r as any).length ?? 0;
  }
  const eff = leaveEffect(kind);
  // Build the SET list from the effect so the three kinds stay in lock-step
  // with lib/leave. Partial kinds only flip the informed flag.
  if (eff.status && eff.deductionDays !== null) {
    const r = await q(
      `UPDATE "DailyAttendance" SET
         status = $4, "isInformed" = TRUE, "deductionDays" = $5,
         source = 'leave', "updatedAt" = NOW()
       WHERE "employeeId" = $1 AND date >= $2 AND date <= $3 AND overridden = FALSE`,
      [employeeId, fromIso, toIso, eff.status, eff.deductionDays],
    );
    return (r as any).length ?? 0;
  }
  const r = await q(
    `UPDATE "DailyAttendance" SET "isInformed" = TRUE, "updatedAt" = NOW()
      WHERE "employeeId" = $1 AND date >= $2 AND date <= $3 AND overridden = FALSE`,
    [employeeId, fromIso, toIso],
  );
  return (r as any).length ?? 0;
}

// Re-run the engine over the existing (non-overridden) attendance rows in a
// date range — used after a leave is CANCELLED so a day that was forced to
// LEAVE / HALF_DAY snaps back to its true biometric status. Reads each day's
// fresh context (the cancelled leave is already gone), re-classifies from the
// punches on file, and re-applies any OTHER still-standing declaration.
export async function reclassifyDays(
  q: Q,
  emp: EmployeeRow,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const rows = (await q(
    `SELECT id, date, "scheduledIn", "scheduledOut", "actualIn", "actualOut", "workDurMin"
       FROM "DailyAttendance"
      WHERE "employeeId" = $1 AND date >= $2 AND date <= $3 AND overridden = FALSE`,
    [emp.id, fromIso, toIso],
  )) as any[];

  let n = 0;
  const ctxCache = new Map<string, DayContext>();
  for (const r of rows) {
    const iso = typeof r.date === 'string' ? r.date.slice(0, 10) : isoString(r.date);
    let ctx = ctxCache.get(iso);
    if (!ctx) { ctx = await loadDayContext(q, iso); ctxCache.set(iso, ctx); }

    const ci: ClassifyInput = {
      scheduledIn: r.scheduledIn ?? emp.shiftIn,
      scheduledOut: r.scheduledOut ?? emp.shiftOut,
      actualIn: r.actualIn,
      actualOut: r.actualOut,
      isWeeklyOff: weekdayOf(iso) === emp.weeklyOffDay,
      isHoliday: ctx.isHoliday,
      leaveKind: ctx.leaveByEmp.get(emp.id) ?? null,
      onDuty: ctx.onDutyEmps.has(emp.id),
    };
    const c = classifyDay(ci);

    let status = c.status, informed = false, deduction = c.rawDeductionDays, remark = c.remark;
    const decl = ctx.declByEmp.get(emp.id);
    if (decl) {
      const eff = leaveEffect(decl);
      informed = eff.informed;
      if (eff.status) status = eff.status;
      if (eff.deductionDays !== null) deduction = eff.deductionDays;
    }
    await q(
      `UPDATE "DailyAttendance" SET status=$1, "isInformed"=$2, "deductionDays"=$3,
              remark=$4, "lateByMin"=$5, "earlyGoingMin"=$6, "isOvertime"=$7,
              source='biometric', "updatedAt"=NOW()
        WHERE id=$8`,
      [status, informed, deduction, remark, c.lateByMin, c.earlyGoingMin, c.isOvertime, r.id],
    );
    n++;
  }
  return n;
}

function isoString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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
  ctx: DayContext,
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

  // Apply any self-service partial-day declaration (half / late / early) on
  // top of the engine's call: the day becomes informed (green) and, for a
  // half day, takes the half-day status + deduction. Full-day leaves were
  // already folded into ci.leaveKind above, so they don't appear here.
  const decl = ctx.declByEmp.get(emp.id);
  let finalStatus = c.status;
  let finalInformed = false;
  let finalDeduction = c.rawDeductionDays;
  let finalRemark = c.remark;
  if (decl) {
    const eff = leaveEffect(decl);
    finalInformed = eff.informed;
    if (eff.status) finalStatus = eff.status;
    if (eff.deductionDays !== null) finalDeduction = eff.deductionDays;
    finalRemark = c.remark ? `${c.remark} · declared ${decl}` : `declared ${decl}`;
  }

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
           status = $9, "isInformed" = $10, "deductionDays" = $11,
           remark = $12, "isOvertime" = $13, source = 'biometric', "updatedAt" = NOW()
         WHERE id = $14`,
        [row.machineCode, ci.scheduledIn, ci.scheduledOut, actualIn, actualOut,
         c.lateByMin, c.earlyGoingMin, row.workDurMin, finalStatus, finalInformed, finalDeduction,
         finalRemark, c.isOvertime, existing.id],
      );
    }
  } else {
    await q(
      `INSERT INTO "DailyAttendance"
        (id, "employeeId", "machineCode", date, "scheduledIn", "scheduledOut",
         "actualIn", "actualOut", "lateByMin", "earlyGoingMin", "workDurMin",
         status, "isInformed", "deductionDays", remark, "isOvertime", source, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'biometric',NOW(),NOW())`,
      [newId('att'), emp.id, row.machineCode, iso, ci.scheduledIn, ci.scheduledOut,
       actualIn, actualOut, c.lateByMin, c.earlyGoingMin, row.workDurMin,
       finalStatus, finalInformed, finalDeduction, finalRemark, c.isOvertime],
    );
  }
}
