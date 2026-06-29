// ============================================================
// lib/leave.ts — self-service leave vocabulary + attendance effect.
// ============================================================
// Employees declare their own time off here; there is NO approval step.
// A declaration immediately drives the attendance engine: it marks the
// day "informed" (green) so the person never shows as an unexplained
// absentee, and (for full / half days) sets the status + day-fraction.
//
// Client-safe: pure data + pure functions, NO database import, so both
// the browser page and the server API/engine can share one source of
// truth for what each leave kind MEANS.
// ============================================================

export const LEAVE_KINDS = ['FULL_DAY', 'HALF_DAY', 'PERIOD_LEAVE', 'LATE_ARRIVAL', 'EARLY_OUT'] as const;
export type LeaveKindSS = (typeof LEAVE_KINDS)[number];

export const LEAVE_LABEL: Record<LeaveKindSS, string> = {
  FULL_DAY: 'Full-day leave',
  HALF_DAY: 'Half-day leave',
  PERIOD_LEAVE: 'Period leave',
  LATE_ARRIVAL: 'Late arrival',
  EARLY_OUT: 'Early out',
};

export const LEAVE_HINT: Record<LeaveKindSS, string> = {
  FULL_DAY: 'Off for the whole day (counts against your paid-leave balance).',
  HALF_DAY: 'Off for half the day — counts as half a paid leave.',
  PERIOD_LEAVE: 'Monthly period leave — paid, and NOT counted against your paid-leave balance.',
  LATE_ARRIVAL: 'Coming in later than your shift start — informed, not penalised.',
  EARLY_OUT: 'Leaving before your shift ends — informed, not penalised.',
};

// Full / half / period leave span multiple dates; late / early are a single day.
export function isSingleDayKind(kind: LeaveKindSS): boolean {
  return kind === 'LATE_ARRIVAL' || kind === 'EARLY_OUT';
}

// Paid-leave balance consumed PER DAY by a kind (full = 1, half = 0.5).
// Period leave is paid but FREE — it never draws the annual balance — and the
// partial-day informed kinds cost nothing either.
export function balancePerDay(kind: LeaveKindSS): number {
  if (kind === 'FULL_DAY') return 1;
  if (kind === 'HALF_DAY') return 0.5;
  return 0;
}

export interface LeaveEffect {
  // Force this DailyAttendance status, or null to keep the engine's call
  // (used for the informed-only partial kinds).
  status: 'LEAVE' | 'HALF_DAY' | null;
  // A declared day is always "informed" — green, never an unexplained absence.
  informed: boolean;
  // Override the day-fraction deduction, or null to keep the engine's value.
  deductionDays: number | null;
}

// What a single declared day DOES to that day's attendance record.
export function leaveEffect(kind: LeaveKindSS): LeaveEffect {
  switch (kind) {
    case 'FULL_DAY':     return { status: 'LEAVE',     informed: true, deductionDays: 0 };
    case 'HALF_DAY':     return { status: 'HALF_DAY',  informed: true, deductionDays: 0.5 };
    case 'PERIOD_LEAVE': return { status: 'LEAVE',     informed: true, deductionDays: 0 };
    case 'LATE_ARRIVAL': return { status: null,        informed: true, deductionDays: null };
    case 'EARLY_OUT':    return { status: null,        informed: true, deductionDays: null };
  }
}

export function isLeaveKind(s: string): s is LeaveKindSS {
  return (LEAVE_KINDS as readonly string[]).includes(s);
}
