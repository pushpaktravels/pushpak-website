// ============================================================
// lib/reco.ts — reconciliation status-board vocabulary + period maths.
// ============================================================
// Shared by the Reco API (validation, period computation) and the page
// (dropdowns, labels). Client-safe: NO DB imports, so it bundles into the
// browser.
//
// The board replaces two Excel sheets: Shashank's daily bank reconciliation
// and Reeta's airline-account reconciliation. Each "account" (a bank or an
// airline) has a cadence (how often it must be reconciled); a person marks
// it reconciled for the current period and the board shows, at a glance,
// what is done vs still pending. Portal-only — no FinBook writes.
// ============================================================

export const RECO_KINDS = ['bank', 'airline'] as const;
export type RecoKind = typeof RECO_KINDS[number];

export const RECO_KIND_LABEL: Record<string, string> = {
  bank: 'Bank account',
  airline: 'Airline account',
};

export const RECO_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type RecoCadence = typeof RECO_CADENCES[number];

export const RECO_CADENCE_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
};

// Status of a single reconciliation entry. 'flagged' = reconciled but a
// mismatch was noted (statement vs books differ); the board surfaces it amber.
export const RECO_STATUSES = ['done', 'flagged'] as const;
export type RecoStatus = typeof RECO_STATUSES[number];

export const RECO_STATUS_COLOR: Record<string, string> = {
  done: '#2E7D4F', flagged: '#C98A14', pending: '#B5483D',
};

// ─── Period maths ─────────────────────────────────────────────
// A "period key" is the stable identifier for the cycle an account is being
// reconciled for. It is what we store on a RecoLog and compare against the
// CURRENT period to decide whether an account is up to date.
//   daily   → 2026-06-03
//   weekly  → 2026-W23   (ISO week)
//   monthly → 2026-06
// Computed in LOCAL time so "today" matches the desk's calendar day.

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

// ISO-8601 week number (weeks start Monday; week 1 contains the year's first
// Thursday). Returns { year, week } — note the year can differ from the
// calendar year for the first/last days of January/December.
function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;            // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);      // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: date.getUTCFullYear(), week };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function periodKey(cadence: string, when: Date = new Date()): string {
  if (cadence === 'weekly') { const { year, week } = isoWeek(when); return `${year}-W${pad(week)}`; }
  if (cadence === 'monthly') { return `${when.getFullYear()}-${pad(when.getMonth() + 1)}`; }
  // daily (default)
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

export function periodLabel(cadence: string, when: Date = new Date()): string {
  if (cadence === 'weekly') { const { year, week } = isoWeek(when); return `Week ${week}, ${year}`; }
  if (cadence === 'monthly') { return `${MONTHS[when.getMonth()]} ${when.getFullYear()}`; }
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
}

// Human phrase for "how often" used in the empty/help copy.
export const CADENCE_HINT: Record<string, string> = {
  daily: 'reconcile every working day',
  weekly: 'reconcile once a week',
  monthly: 'reconcile once a month',
};
