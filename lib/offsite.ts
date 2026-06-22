// ============================================================
// lib/offsite.ts — offsite (self check-in) attendance logic.
// ============================================================
// Offsite staff don't punch the office machine, so they never appear in
// the biometric file. Instead:
//   • a GPS check-in writes a real DailyAttendance row (source 'offsite',
//     status PRESENT — or OFF_DAY/HOLIDAY+overtime if they worked a
//     weekly-off / holiday), so the normal payroll tally counts it; and
//   • every ELAPSED working day with NO row is treated as ABSENT (a
//     missed day), weekly-offs/holidays stay paid, future days don't
//     count yet.
//
// The second half is computed in-memory at read time (it never writes
// rows during a payroll PREVIEW, which must touch nothing). Both the
// payroll route and the Offsite review page call the same helpers here
// so the numbers can never drift.
//
// Client-safe: pure data + pure functions, NO database import.
// ============================================================

export const ATTENDANCE_MODES = ['biometric', 'offsite'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ATTENDANCE_MODE_LABEL: Record<AttendanceMode, string> = {
  biometric: 'Office (biometric)',
  offsite: 'Offsite (self check-in)',
};

export function isAttendanceMode(s: string): s is AttendanceMode {
  return (ATTENDANCE_MODES as readonly string[]).includes(s);
}

// ─── Date helpers (UTC, to match the DATE columns) ───────────────
export function isoToUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function utcToIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// Weekday for a "YYYY-MM-DD" date (0=Sun..6=Sat).
export function weekdayOf(iso: string): number {
  return isoToUtc(iso).getUTCDay();
}

// ─── Per-day status derivation ───────────────────────────────────
// What a check-in MEANS for the day. A punch on a normal working day is
// PRESENT; a punch on the employee's weekly-off or a holiday keeps that
// day's paid status AND flags it overtime (one OT day), exactly like the
// biometric classifier does. We deliberately do NOT apply late/half-day
// timing rules to offsite field staff — any check-in is a full day.
export function deriveCheckinStatus(args: {
  isWeeklyOff: boolean;
  isHoliday: boolean;
}): { status: 'PRESENT' | 'OFF_DAY' | 'HOLIDAY'; isOvertime: boolean } {
  if (args.isHoliday) return { status: 'HOLIDAY', isOvertime: true };
  if (args.isWeeklyOff) return { status: 'OFF_DAY', isOvertime: true };
  return { status: 'PRESENT', isOvertime: false };
}

// Status for a day that has NO row and NO check-in, for an offsite
// employee — i.e. how a missing elapsed day is filled.
export type MissingStatus = 'OFF_DAY' | 'HOLIDAY' | 'LEAVE' | 'HALF_DAY' | 'ABSENT';

export function deriveMissingStatus(args: {
  isWeeklyOff: boolean;
  isHoliday: boolean;
  leave: 'FULL' | 'HALF' | null;
}): MissingStatus {
  if (args.leave === 'FULL') return 'LEAVE';
  if (args.leave === 'HALF') return 'HALF_DAY';
  if (args.isWeeklyOff) return 'OFF_DAY';
  if (args.isHoliday) return 'HOLIDAY';
  return 'ABSENT';
}

// ─── Month synthesis ─────────────────────────────────────────────
export type OffsiteMonthInput = {
  monthStart: string;            // "YYYY-MM-01"
  daysInMonth: number;           // 28..31
  weeklyOffDay: number;          // 0..6
  holidays: Set<string>;         // ISO dates that are holidays
  rowDates: Set<string>;         // dates that already have a DailyAttendance row
  leaveDates: Map<string, 'FULL' | 'HALF'>; // approved-leave dates from LeaveRequest
  todayIso: string;              // server "today" — days after this don't count
  joiningIso?: string | null;    // don't count days before the employee joined
};

export type MissingCounts = {
  absent: number;
  offDay: number;
  holiday: number;
  leave: number;
  halfDay: number;
};

// Walk every day of the month and, for the elapsed days that DON'T already
// have a DailyAttendance row, classify the gap (absent / off / holiday /
// leave). These counts are MERGED into the payroll tally for an offsite
// employee on top of the counts from their real rows (check-ins).
export function synthesizeMissing(inp: OffsiteMonthInput): MissingCounts {
  const out: MissingCounts = { absent: 0, offDay: 0, holiday: 0, leave: 0, halfDay: 0 };
  const [y, m] = inp.monthStart.split('-').map(Number);
  for (let day = 1; day <= inp.daysInMonth; day++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (iso >= inp.todayIso) break;                      // today or later — not
    // counted yet: the day isn't over, so a missing check-in today is NOT an
    // absence (the employee may still punch in). Only ELAPSED days can be absent.
    if (inp.joiningIso && iso < inp.joiningIso) continue; // before joining
    if (inp.rowDates.has(iso)) continue;                 // already a real row
    const st = deriveMissingStatus({
      isWeeklyOff: weekdayOf(iso) === inp.weeklyOffDay,
      isHoliday: inp.holidays.has(iso),
      leave: inp.leaveDates.get(iso) ?? null,
    });
    if (st === 'ABSENT') out.absent++;
    else if (st === 'OFF_DAY') out.offDay++;
    else if (st === 'HOLIDAY') out.holiday++;
    else if (st === 'LEAVE') out.leave++;
    else if (st === 'HALF_DAY') out.halfDay++;
  }
  return out;
}

// A single calendar day in the Offsite review grid: either a real row
// (a check-in, with GPS) or a synthesized gap day.
export type OffsiteGridDay = {
  date: string;
  status: string;          // PRESENT / OFF_DAY / HOLIDAY / LEAVE / HALF_DAY / ABSENT
  isOvertime: boolean;
  source: 'offsite' | 'leave' | 'derived' | 'other';
  inAt: string | null;     // ISO timestamp of the first check-in
  outAt: string | null;    // ISO timestamp of the last check-out
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  note: string | null;
  future: boolean;
};
