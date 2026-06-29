// ============================================================
// lib/period-leave.ts — menstrual-cycle tracking for period leave.
// ============================================================
// Pure + client-safe (no DB import), like lib/leave.ts. Given the dates an
// employee has taken period leave (ascending ISO), we estimate her cycle,
// predict next month's likely window, and decide whether a NEW entry looks
// off-pattern (suspiciously frequent / a second one in the same calendar
// month) so the owner can review.
//
// DIGNIFIED by design: no medical proof, no screenshots, no app data — we
// reason ONLY over the leave dates already declared in the portal. The signal
// is a gentle "worth a look", never an automatic accusation; the owner makes
// the call. The shared math lives here so the self-service and HR routes (and
// the UI prediction) can never drift apart.
// ============================================================

export const PERIOD_CYCLE_DEFAULT = 28; // typical cycle length (days) when we can't learn one yet
export const PERIOD_WINDOW_TOLERANCE = 5; // ± days around the expected date = the "due" window
export const PERIOD_MIN_GAP = 21;         // a gap shorter than this between two period leaves = off-pattern

export interface PeriodInsight {
  count: number;             // how many period leaves are on record
  lastDate: string | null;   // most recent start (ISO), or null
  cycleDays: number | null;  // learned cycle (median monthly gap), or null when <2 on record
  nextExpected: string | null; // predicted next start (ISO), or null
  windowFrom: string | null; // start of the due window (ISO)
  windowTo: string | null;   // end of the due window (ISO)
}

function isoToUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function isoOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function addDays(iso: string, n: number): string {
  return isoOf(new Date(isoToUtc(iso).getTime() + n * 86400000));
}
function gapDays(aIso: string, bIso: string): number {
  return Math.round((isoToUtc(bIso).getTime() - isoToUtc(aIso).getTime()) / 86400000);
}
function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Build the cycle insight from the ascending list of period-leave START dates.
export function periodInsight(startsIsoAsc: string[]): PeriodInsight {
  const starts = [...startsIsoAsc].filter(Boolean).sort();
  const count = starts.length;
  const lastDate = count ? starts[count - 1] : null;

  // Need at least two leaves to learn a cycle; otherwise assume the default.
  let cycleDays: number | null = null;
  if (count >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < starts.length; i++) gaps.push(gapDays(starts[i - 1], starts[i]));
    // Keep only plausible monthly gaps so one outlier (a skipped month, or two
    // in a month) doesn't wreck the estimate; fall back to all gaps if that
    // filter empties the list.
    const monthly = gaps.filter((g) => g >= PERIOD_MIN_GAP && g <= 35);
    cycleDays = median(monthly.length ? monthly : gaps);
  }

  const eff = cycleDays ?? PERIOD_CYCLE_DEFAULT;
  const nextExpected = lastDate ? addDays(lastDate, eff) : null;
  const windowFrom = nextExpected ? addDays(nextExpected, -PERIOD_WINDOW_TOLERANCE) : null;
  const windowTo = nextExpected ? addDays(nextExpected, PERIOD_WINDOW_TOLERANCE) : null;

  return { count, lastDate, cycleDays, nextExpected, windowFrom, windowTo };
}

export interface PeriodFlag {
  flagged: boolean;
  reason: string | null;
  gapDays: number | null; // gap from the previous period leave (null if first-ever)
}

// Decide whether a NEW period-leave start looks like misuse, given the prior
// starts (any order). Two simple, explainable triggers measured against the
// closest leave strictly BEFORE the new one (robust to back-dated entries):
//   • it falls in the SAME calendar month as that previous leave (a 2nd one), or
//   • the gap is shorter than PERIOD_MIN_GAP days (too frequent).
// The first-ever period leave is never flagged.
export function flagNewPeriodLeave(priorStartsIsoAsc: string[], newStartIso: string): PeriodFlag {
  const before = [...priorStartsIsoAsc].filter((s) => s && s < newStartIso).sort();
  const prev = before.length ? before[before.length - 1] : null;
  if (!prev) return { flagged: false, reason: null, gapDays: null };

  const g = gapDays(prev, newStartIso);
  if (newStartIso.slice(0, 7) === prev.slice(0, 7)) {
    return { flagged: true, reason: `A second period leave in ${prev.slice(0, 7)} (the previous one was ${prev}).`, gapDays: g };
  }
  if (g < PERIOD_MIN_GAP) {
    return { flagged: true, reason: `Only ${g} days since the last period leave (${prev}); a cycle is usually ~${PERIOD_CYCLE_DEFAULT} days.`, gapDays: g };
  }
  return { flagged: false, reason: null, gapDays: g };
}
