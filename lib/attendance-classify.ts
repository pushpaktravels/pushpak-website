// ============================================================
// attendance-classify.ts — turn a day's punches into a status.
// ============================================================
// Pure functions (no DB). The caller resolves the inputs (joins
// yesterday-OUT + today-IN, looks up holiday/weekly-off/leave) and
// passes them in; this module applies the confirmed business rules.
//
// CONFIRMED RULES (2026-05-29):
//   • Grace = 7 min from scheduled in. Late only if lateBy > 7.
//   • Arrived after 11:00 OR left before 16:00 → HALF_DAY (0.5).
//       (absolute clock times, independent of shift)
//   • Late (after grace, but in by 11:00) → LATE. First 3 lates/month
//     are free; 4th+ = 0.25 day each — but that TIERING is a MONTHLY
//     calc, so a single LATE day carries rawDeductionDays = 0 here.
//   • Early-going down to 16:00 is NOT flagged.
//   • No punch on a working day → ABSENT (LWP), rawDeductionDays = 1.
//   • Leave / Holiday / Weekly-off take precedence over punches.
//   • "Green" (informed late/early, 1 free/month) is a MANUAL flag,
//     not derivable from biometric — set via override, not here.
//
// rawDeductionDays = day-fraction lost BEFORE late-tiering and before
// any leave-balance offset. The monthly payroll engine consumes this
// plus the late count and leave balance to produce final pay.
// ============================================================

export const GRACE_MIN = 7;
export const HALF_DAY_LATE_CUTOFF_MIN = 11 * 60;   // 11:00 — in after this = 0.5L
export const EARLY_HALF_DAY_CUTOFF_MIN = 16 * 60;  // 16:00 — out before this = 0.5L

export type AttStatus =
  | 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT'
  | 'LEAVE' | 'OFF_DAY' | 'HOLIDAY' | 'ON_DUTY' | 'SPECIAL_PAID';

export type LeaveKind = 'PAID_FROM_BALANCE' | 'SPECIAL_PAID' | 'LWP';

export type ClassifyInput = {
  scheduledIn: string | null;   // "HH:MM" or null (NS / no shift)
  scheduledOut: string | null;
  actualIn: string | null;      // from the date's own file
  actualOut: string | null;     // from the NEXT day's file; null until finalized
  isWeeklyOff: boolean;
  isHoliday: boolean;
  // approved leave covering this date, if any
  leaveKind?: LeaveKind | null;
  // approved on-duty (field work) covering this date
  onDuty?: boolean;
};

export type ClassifyResult = {
  status: AttStatus;
  isLate: boolean;
  lateByMin: number;            // computed from actualIn vs scheduledIn (0 if N/A)
  earlyGoingMin: number;        // minutes before scheduledOut (reference; 0 if N/A)
  leftBefore16: boolean;
  arrivedAfter11: boolean;
  rawDeductionDays: number;     // 0 / 0.5 / 1  (late-tiering applied monthly)
  provisional: boolean;         // true when OUT not yet finalized
  remark: string | null;
};

function toMin(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function classifyDay(input: ClassifyInput): ClassifyResult {
  const base: ClassifyResult = {
    status: 'PRESENT',
    isLate: false,
    lateByMin: 0,
    earlyGoingMin: 0,
    leftBefore16: false,
    arrivedAfter11: false,
    rawDeductionDays: 0,
    provisional: false,
    remark: null,
  };

  // 1) Approved leave / on-duty take precedence over everything.
  if (input.onDuty) {
    return { ...base, status: 'ON_DUTY' };
  }
  if (input.leaveKind) {
    if (input.leaveKind === 'PAID_FROM_BALANCE') return { ...base, status: 'LEAVE' };
    if (input.leaveKind === 'SPECIAL_PAID') return { ...base, status: 'SPECIAL_PAID' };
    // LWP leave
    return { ...base, status: 'ABSENT', rawDeductionDays: 1, remark: 'Leave without pay' };
  }

  // 2) Holiday / weekly-off (paid, no punch expected).
  if (input.isHoliday) return { ...base, status: 'HOLIDAY' };
  if (input.isWeeklyOff) return { ...base, status: 'OFF_DAY' };

  const inMin = toMin(input.actualIn);
  const outMin = toMin(input.actualOut);
  const schedInMin = toMin(input.scheduledIn);
  const schedOutMin = toMin(input.scheduledOut);

  // 3) No in-punch on a working day → absent (LWP).
  if (inMin == null) {
    return { ...base, status: 'ABSENT', rawDeductionDays: 1, remark: 'No punch' };
  }

  const provisional = outMin == null; // OUT not finalized yet (today's file)

  // Absolute half-day triggers (independent of shift).
  const arrivedAfter11 = inMin > HALF_DAY_LATE_CUTOFF_MIN;
  const leftBefore16 = outMin != null && outMin < EARLY_HALF_DAY_CUTOFF_MIN;

  // Lateness vs schedule (only when a schedule exists).
  const lateByMin = schedInMin != null ? Math.max(0, inMin - schedInMin) : 0;
  const earlyGoingMin =
    schedOutMin != null && outMin != null ? Math.max(0, schedOutMin - outMin) : 0;

  if (arrivedAfter11 || leftBefore16) {
    const why = arrivedAfter11 ? 'In after 11:00' : 'Left before 16:00';
    return {
      ...base,
      status: 'HALF_DAY',
      isLate: lateByMin > GRACE_MIN,
      lateByMin,
      earlyGoingMin,
      leftBefore16,
      arrivedAfter11,
      rawDeductionDays: 0.5,
      provisional,
      remark: why,
    };
  }

  // Late (past grace, but in by 11:00). Deduction tiering is monthly.
  if (schedInMin != null && lateByMin > GRACE_MIN) {
    return {
      ...base,
      status: 'LATE',
      isLate: true,
      lateByMin,
      earlyGoingMin,
      provisional,
      remark: `Late by ${lateByMin} min`,
    };
  }

  // On time (or no schedule to judge against).
  return { ...base, status: 'PRESENT', lateByMin, earlyGoingMin, provisional };
}

// ─── Join helper ────────────────────────────────────────────────
// For a given date we want that date's own IN and that date's own OUT.
// The biometric file printed ON a date carries IN for that date but an
// empty OUT ("Absent (No OutPunch)"). The NEXT day's file finalizes the
// prior date's OUT. This merges a fresh row over an existing record:
// keep the most specific (non-null) IN/OUT for the date.
export function mergePunch(
  existing: { actualIn: string | null; actualOut: string | null } | null,
  incoming: { actualIn: string | null; actualOut: string | null },
): { actualIn: string | null; actualOut: string | null } {
  return {
    actualIn: incoming.actualIn ?? existing?.actualIn ?? null,
    actualOut: incoming.actualOut ?? existing?.actualOut ?? null,
  };
}
