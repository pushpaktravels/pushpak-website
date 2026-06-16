// ============================================================
// payroll.ts — monthly salary math (pure, no DB).
// ============================================================
// Turns a month's worth of classified attendance into a payslip.
// All business rules confirmed with the owner (2026-05-30):
//
//   • CALENDAR-DAY DIVISOR: perDaySalary = monthlySalary ÷ calendar
//     days in the month (28–31), NOT working days.
//   • Paid (no deduction): PRESENT, LATE, LEAVE (within the yearly
//     cap), OFF_DAY (weekly off), HOLIDAY, ON_DUTY, SPECIAL_PAID.
//   • HALF_DAY → 0.5 day deducted.
//   • ABSENT (LWP) → 1 full day deducted.
//   • LATE-TIERING: first 3 LATE days/month are free; each LATE
//     beyond that costs 0.25 day.
//   • 18 PAID LEAVES / FINANCIAL YEAR (Apr–Mar), +carry-over if the
//     employee has it. LEAVE days beyond the entitlement auto-convert
//     to unpaid (1 day deducted each).
//   • ADVANCE: the month's installment (capped at the remaining
//     balance) is subtracted from gross to give net.
//
// The route layer (pages/api/attendance/payroll.ts) resolves the DB
// inputs — day tallies, prior-FY leave count, advance installment —
// and calls computePayroll(). Keeping the arithmetic here makes it
// auditable and unit-testable in isolation.
// ============================================================

export const LATE_FREE_PER_MONTH = 3;
export const LATE_DEDUCTION_EACH = 0.25;
export const DEFAULT_LEAVE_ENTITLEMENT = 18;

// Day-status tallies for one employee in one month. `late` is the
// count of LATE-status days (which are ALSO counted in `present`,
// since a late day is still a worked day); the others are mutually
// exclusive day counts.
export type PayrollCounts = {
  present: number;      // includes LATE days
  late: number;         // LATE-status days (subset of present)
  halfDay: number;
  absent: number;       // LWP / no punch
  leave: number;        // LEAVE days falling in THIS month
  offDay: number;       // weekly offs
  holiday: number;
  onDuty: number;
  specialPaid: number;
  overtime: number;     // days worked on a weekly-off / holiday (pay unaffected)
};

export type PayrollInput = {
  monthlySalary: number;
  daysInMonth: number;            // 28–31 (calendar)
  counts: PayrollCounts;
  leaveEntitlement: number;       // usually 18 (+carry-over)
  priorLeaveDaysInFY: number;     // LEAVE days already taken earlier this FY
  advanceInstallmentDue: number;  // capped installment for this month (0 if none)
};

export type PayrollResult = {
  daysInMonth: number;
  presentDays: number;
  halfDays: number;
  paidLeaves: number;         // leave days within the yearly cap (paid)
  excessLeaves: number;       // leave days beyond the cap (unpaid)
  lwpDays: number;            // absent + excess leaves
  paidHolidays: number;
  weeklyOffs: number;
  onDutyDays: number;
  overtimeDays: number;       // days worked on a weekly-off / holiday (info only)
  lateCount: number;
  lateDeductionDays: number;
  deductionDays: number;      // total day-fractions lost
  netPayableDays: number;     // daysInMonth − deductionDays
  perDaySalary: number;
  grossSalary: number;
  advanceDeduction: number;
  netSalary: number;
};

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function computePayroll(inp: PayrollInput): PayrollResult {
  const c = inp.counts;
  const daysInMonth = inp.daysInMonth > 0 ? inp.daysInMonth : 30; // guard /0

  // 18-leave cap (financial year). Whatever entitlement is left after
  // earlier months caps how many of THIS month's leaves are paid; the
  // rest convert to unpaid.
  const remainingEntitlement = Math.max(0, inp.leaveEntitlement - inp.priorLeaveDaysInFY);
  const paidLeaves = Math.min(c.leave, remainingEntitlement);
  const excessLeaves = Math.max(0, c.leave - paidLeaves);

  const lwpDays = c.absent + excessLeaves;

  // First 3 lates free; 4th+ = 0.25 day each.
  const lateDeductionDays = round2(Math.max(0, c.late - LATE_FREE_PER_MONTH) * LATE_DEDUCTION_EACH);

  const deductionDays = round2(c.halfDay * 0.5 + lwpDays * 1 + lateDeductionDays);
  const netPayableDays = round2(Math.max(0, daysInMonth - deductionDays));

  const perDaySalary = round2(inp.monthlySalary / daysInMonth);
  const grossSalary = round2(Math.max(0, perDaySalary * netPayableDays));

  const advanceDeduction = round2(Math.max(0, Math.min(inp.advanceInstallmentDue, grossSalary)));
  const netSalary = round2(Math.max(0, grossSalary - advanceDeduction));

  return {
    daysInMonth,
    presentDays: c.present,
    halfDays: c.halfDay,
    paidLeaves,
    excessLeaves,
    lwpDays,
    paidHolidays: c.holiday,
    weeklyOffs: c.offDay,
    onDutyDays: c.onDuty,
    overtimeDays: c.overtime,
    lateCount: c.late,
    lateDeductionDays,
    deductionDays,
    netPayableDays,
    perDaySalary,
    grossSalary,
    advanceDeduction,
    netSalary,
  };
}

// ─── Date helpers ───────────────────────────────────────────────
// Calendar days in a "YYYY-MM" month.
export function daysInCalendarMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of next month = last day of this
}

// Indian financial year (Apr–Mar) that a "YYYY-MM" month belongs to.
// Returns { label: "2026-2027", start: "2026-04-01", monthStart: "YYYY-MM-01" }.
export function financialYearOf(month: string): { label: string; start: string; monthStart: string } {
  const [y, m] = month.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return {
    label: `${startYear}-${startYear + 1}`,
    start: `${startYear}-04-01`,
    monthStart: `${y}-${String(m).padStart(2, '0')}-01`,
  };
}

// First-of-month (inclusive) and first-of-next-month (exclusive) for a
// half-open date range query.
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end };
}
