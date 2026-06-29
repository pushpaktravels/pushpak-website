// ============================================================
// lib/leave-engine.ts — the ONE engine behind every leave write.
// ============================================================
// Three routes record / cancel leave and they MUST stay byte-identical
// in their balance maths and attendance effect, or the numbers drift:
//   • pages/api/leave/index.ts        — self-service declare (own leave)
//   • pages/api/leave/[id].ts         — self-service cancel  (own leave)
//   • pages/api/attendance/leave-admin.ts — HR declares / cancels on behalf
//
// Historically each route carried its own copy of the INSERT, the
// LeaveBalance drawdown / credit, and the applyDeclarationToDays /
// reclassifyDays call. That duplication bit us once already (a balance
// clamp fix had to be made in two files); a third copy would be one more
// place to forget. So the shared mechanics live here, and each route only
// keeps what is genuinely its own: WHO the employee is, WHO is recorded as
// the author (self vs "(HR)"), and which audit event to emit.
//
// Server-only (imports pg + attendance-db). The client-safe leave
// vocabulary still lives in lib/leave.ts.
// ============================================================
import { withTransaction, newId } from '@/lib/pg';
import {
  financialYearOf, isoToUtcDate, applyDeclarationToDays, reclassifyDays, type EmployeeRow,
} from '@/lib/attendance-db';
import { balancePerDay, isSingleDayKind, type LeaveKindSS } from '@/lib/leave';

// Inclusive calendar-day count between two ISO dates.
function dayspan(fromIso: string, toIso: string): number {
  const a = isoToUtcDate(fromIso).getTime();
  const b = isoToUtcDate(toIso).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

function isoString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// The resolved shape of a declaration: the date range plus the costs
// payroll / the balance read. Pure (no DB) so a route can validate first.
export interface LeavePlan {
  kind: LeaveKindSS;
  fromDate: string;
  toDate: string;
  numDays: number;     // inclusive calendar days in range
  days: number;        // stored LeaveRequest.days
  balanceCost: number; // paid-leave balance drawn down
  fy: string;          // financial year of the start date
}

export type PlanResult =
  | { ok: true; plan: LeavePlan }
  | { ok: false; error: string };

// Validate + cost a declaration. Returns a 400-able error string for the
// two user-facing failures (bad range / too long) instead of throwing, so
// the caller keeps them a 400 rather than a 500. Mirrors what the three
// routes computed inline before.
export function planLeave(kind: LeaveKindSS, fromDate: string, toDateRaw?: string | null): PlanResult {
  // Late-arrival / early-out are single-day by definition.
  const toDate = isSingleDayKind(kind) ? fromDate : (toDateRaw || fromDate);
  if (toDate < fromDate) return { ok: false, error: 'End date is before start date.' };

  const numDays = dayspan(fromDate, toDate);
  if (numDays > 60) return { ok: false, error: 'That range is too long (max 60 days).' };

  const perDay = balancePerDay(kind);          // 1 / 0.5 / 0
  // Full-day AND period leave occupy whole calendar days, so the stored day
  // count reflects the range; period leave just has perDay 0, so it never
  // draws the paid-leave balance (balanceCost stays 0).
  const fullSpan = kind === 'FULL_DAY' || kind === 'PERIOD_LEAVE';
  const days = kind === 'HALF_DAY' ? 0.5 : (fullSpan ? numDays : 0);
  const balanceCost = perDay * (kind === 'HALF_DAY' ? 1 : numDays);
  const fy = financialYearOf(isoToUtcDate(fromDate));

  return { ok: true, plan: { kind, fromDate, toDate, numDays, days, balanceCost, fy } };
}

// Record a planned leave: INSERT the already-approved request, draw the
// paid-leave balance down for full / half days (creating the FY row at the
// standard 18-day opening if absent), and reflect it onto any attendance
// already on file. One transaction. Returns the new id + days touched.
export async function recordLeave(args: {
  employeeId: string;
  plan: LeavePlan;
  reason?: string | null;
  appliedBy: string;        // the on-behalf trail: employee, or "Name (HR)"
  note?: string | null;
}): Promise<{ id: string; daysTouched: number }> {
  const { employeeId, plan, reason, appliedBy, note } = args;
  const id = newId('lv');

  const daysTouched = await withTransaction(async (q) => {
    await q(
      `INSERT INTO "LeaveRequest"
         (id, "employeeId", "fromDate", "toDate", days, reason, status, kind,
          "appliedBy", "decidedBy", "decidedAt", notes, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'APPROVED',$7,$8,$8,NOW(),$9,NOW(),NOW())`,
      [id, employeeId, plan.fromDate, plan.toDate, plan.days, reason || null, plan.kind, appliedBy, note || null],
    );

    if (plan.balanceCost > 0) {
      await q(
        `INSERT INTO "LeaveBalance" (id, "employeeId", "financialYear", opening, used, remaining, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,18,$4,18-$4,NOW(),NOW())
         ON CONFLICT ("employeeId","financialYear") DO UPDATE
           SET used = "LeaveBalance".used + $4,
               remaining = "LeaveBalance".remaining - $4,
               "updatedAt" = NOW()`,
        [newId('lbal'), employeeId, plan.fy, plan.balanceCost],
      );
    }

    return applyDeclarationToDays(q, employeeId, plan.fromDate, plan.toDate, plan.kind);
  });

  return { id, daysTouched };
}

// Cancel a recorded leave: delete the request, credit the paid balance
// back (clamped so it can never exceed the opening or go below zero), and
// re-classify the affected days from the punches on file. One transaction.
// The caller owns auth / scoping (self vs HR-on-behalf) and the audit event.
export async function cancelLeaveRecord(args: {
  leave: any;            // the LeaveRequest row being cancelled
  employee: EmployeeRow; // resolved with machineCode/hrCode/weeklyOffDay/shiftIn/shiftOut
}): Promise<{ kind: LeaveKindSS; fromIso: string; toIso: string; balanceCredit: number }> {
  const { leave, employee } = args;

  const kind = leave.kind as LeaveKindSS;
  const fromIso = typeof leave.fromDate === 'string' ? leave.fromDate.slice(0, 10) : isoString(leave.fromDate);
  const toIso = typeof leave.toDate === 'string' ? leave.toDate.slice(0, 10) : isoString(leave.toDate);

  // How much balance to credit back: mirrors what recordLeave drew down.
  const days = Number(leave.days) || 0;
  const balanceCredit = balancePerDay(kind) > 0 ? days : 0;
  const fy = financialYearOf(isoToUtcDate(fromIso));

  await withTransaction(async (q) => {
    await q(`DELETE FROM "LeaveRequest" WHERE id = $1`, [leave.id]);
    if (balanceCredit > 0) {
      await q(
        `UPDATE "LeaveBalance"
            SET used = GREATEST(used - $3, 0),
                remaining = LEAST(opening, remaining + $3),
                "updatedAt" = NOW()
          WHERE "employeeId" = $1 AND "financialYear" = $2`,
        [employee.id, fy, balanceCredit],
      );
    }
    await reclassifyDays(q, employee, fromIso, toIso);
  });

  return { kind, fromIso, toIso, balanceCredit };
}
