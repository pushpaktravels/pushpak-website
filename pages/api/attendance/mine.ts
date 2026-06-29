// ============================================================
// GET /api/attendance/mine — the caller's OWN attendance only.
// ============================================================
// Self-service: any logged-in employee sees a monthly summary + a
// day-by-day detail for THEMSELVES. Resolves the caller's login
// (User.execId) → their Employee row via Employee."loginExecId".
//
// Hard-scoped to self: the employee is derived from the authenticated
// session, never from a query param, so one user can never read another's
// attendance. Returns { linked:false } when the login isn't yet tied to
// an employee (the owner links it in the employee master).
//
// EVERY day is shown, not only the days with a biometric punch. The raw
// machine file has a row only when someone physically punched, so leaves,
// weekly-offs, holidays and plain absences would otherwise silently vanish
// from the table (the gap the owner spotted: a leave on a no-punch day not
// appearing). We therefore synthesize the full month calendar at read time:
// real punch rows where they exist, else the day's true nature derived from
// the holiday list / weekly-off / approved leave, else ABSENT.
//
// IMPORTANT — only from RULES_START (see below). Before that date attendance &
// leave were maintained manually off-portal and already processed, so we never
// invent days for those months (a manually-taken leave isn't in the portal and
// must NOT be shown as ABSENT). Pre-RULES_START we show ONLY the real figures
// on file; full-calendar synthesis begins on RULES_START.
//
// ?month=YYYY-MM (defaults to the current month).
// Auth: any logged-in user.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { isoToUtcDate, weekdayOf } from '@/lib/attendance-db';

// The day the portal's automated attendance rules go live. BEFORE this date,
// present/leave were maintained manually off-portal and already processed, so
// we must never invent days (no synthesized ABSENT / OFF_DAY / HOLIDAY) — doing
// so would contradict the manual record (e.g. mark a leave day as ABSENT). For
// those months we show ONLY the real figures actually on file. From this date
// on, the full month calendar is synthesized.
const RULES_START = '2026-07-01';

function monthRange(month: string): { start: string; end: string } {
  // start = first of month, end = first of next month (exclusive)
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end };
}

const pad = (n: number) => String(n).padStart(2, '0');

// Normalise a pg DATE (returned as a JS Date or a string) to "YYYY-MM-DD".
function isoOf(v: any): string {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  return String(v).slice(0, 10);
}

// Inclusive list of ISO dates from a → b.
function dateSpan(a: string, b: string): string[] {
  const out: string[] = [];
  let d = isoToUtcDate(a);
  const end = isoToUtcDate(b);
  while (d <= end) { out.push(isoOf(d)); d = new Date(d.getTime() + 86400000); }
  return out;
}

function todayIstIso(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 5);
  d.setUTCMinutes(d.getUTCMinutes() + 30);
  return d.toISOString().slice(0, 10);
}
function thisMonthIst(): string {
  return todayIstIso().slice(0, 7);
}
const minIso = (a: string, b: string) => (a < b ? a : b);

// How a standing leave shows on a no-punch day. Partial informed kinds
// (late / early) need a punch to mean anything, so they're skipped here.
function leaveDisplay(kind: string | null): { status: string; deduction: number } | null {
  switch (kind) {
    case 'FULL_DAY':
    case 'PERIOD_LEAVE':      return { status: 'LEAVE', deduction: 0 }; // paid period leave shows as a leave day
    case 'PAID_FROM_BALANCE': return { status: 'LEAVE', deduction: 0 };
    case 'LWP':               return { status: 'LEAVE', deduction: 1 }; // unpaid, still a leave day
    case 'HALF_DAY':          return { status: 'HALF_DAY', deduction: 0.5 };
    case 'SPECIAL_PAID':      return { status: 'SPECIAL_PAID', deduction: 0 };
    case 'ON_DUTY':           return { status: 'ON_DUTY', deduction: 0 };
    default:                  return null;
  }
}

// A synthesized (no-punch) day row — same shape the panel renders for real rows.
function synthDay(date: string, status: string, deduction: number, remark: string | null, informed = false) {
  return {
    date, status,
    actualIn: null, actualOut: null, scheduledIn: null, scheduledOut: null,
    lateByMin: null, earlyGoingMin: null,
    isInformed: informed, deductionDays: deduction, remark: remark ?? null,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
    ? String(req.query.month)
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const emp = await queryOne<any>(
    `SELECT id, name, "hrCode", department, designation, "shiftIn", "shiftOut", "weeklyOffDay", "joiningDate"
       FROM "Employee" WHERE "loginExecId" = $1 AND active = TRUE`,
    [user.execId],
  );
  if (!emp) {
    return res.json({ ok: true, linked: false, month });
  }

  const { start, end } = monthRange(month);

  // Real attendance rows on file (biometric punches + any human/leave overrides).
  const rows = await query<any>(
    `SELECT date, status, "actualIn", "actualOut", "scheduledIn", "scheduledOut",
            "lateByMin", "earlyGoingMin", "isInformed", "deductionDays", remark
       FROM "DailyAttendance"
      WHERE "employeeId" = $1 AND date >= $2 AND date < $3
      ORDER BY date`,
    [emp.id, start, end],
  );
  const rowByDate = new Map<string, any>();
  for (const r of rows) { const iso = isoOf(r.date); rowByDate.set(iso, { ...r, date: iso }); }

  // Approved leaves overlapping the month — so a leave taken on a day the
  // person never punched (no biometric row) still appears in the table.
  const leaves = await query<any>(
    `SELECT "fromDate", "toDate", kind FROM "LeaveRequest"
      WHERE "employeeId" = $1 AND status = 'APPROVED'
        AND "fromDate" < $3 AND "toDate" >= $2`,
    [emp.id, start, end],
  );
  const leaveByDate = new Map<string, { status: string; deduction: number }>();
  for (const lv of leaves) {
    const eff = leaveDisplay(lv.kind);
    if (!eff) continue;
    for (const iso of dateSpan(isoOf(lv.fromDate), isoOf(lv.toDate))) {
      if (iso < start || iso >= end) continue;
      leaveByDate.set(iso, eff);
    }
  }

  // Holidays this month.
  const hols = await query<any>(`SELECT date, name FROM "Holiday" WHERE date >= $1 AND date < $2`, [start, end]);
  const holByDate = new Map<string, string>();
  for (const h of hols) holByDate.set(isoOf(h.date), h.name);

  // Synthesis window: from the first day we actually KNOW about this month
  // (first punch row or first approved leave) through today (or month-end for
  // past months). Starting at first-known avoids inventing "absent" days for
  // the stretch before attendance tracking began. Never before joiningDate.
  const known = [...rowByDate.keys(), ...leaveByDate.keys()].sort();
  const lastOfMonth = isoOf(new Date(isoToUtcDate(end).getTime() - 86400000));
  const cap = month >= thisMonthIst() ? minIso(todayIstIso(), lastOfMonth) : lastOfMonth;
  let synthStart = known.length ? known[0] : null;
  const joiningIso = emp.joiningDate ? isoOf(emp.joiningDate) : null;
  if (synthStart && joiningIso && joiningIso > synthStart) synthStart = joiningIso;

  const days: any[] = [];
  if (synthStart && synthStart <= cap) {
    for (const iso of dateSpan(synthStart, cap)) {
      const real = rowByDate.get(iso);
      if (real) { days.push(real); continue; }
      // Manual era: show only what's truly on file, never an invented day.
      if (iso < RULES_START) continue;
      if (holByDate.has(iso)) { days.push(synthDay(iso, 'HOLIDAY', 0, holByDate.get(iso)!)); continue; }
      if (weekdayOf(iso) === emp.weeklyOffDay) { days.push(synthDay(iso, 'OFF_DAY', 0, null)); continue; }
      const lv = leaveByDate.get(iso);
      if (lv) { days.push(synthDay(iso, lv.status, lv.deduction, null, true)); continue; }
      days.push(synthDay(iso, 'ABSENT', 1, null)); // a working day with no punch and no leave
    }
  } else {
    for (const r of rowByDate.values()) days.push(r);
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Tally from the synthesized calendar so leave / off / holiday / absent all
  // count — this is the same month picture the rest of the portal reads.
  const summary = {
    present: 0, late: 0, halfDay: 0, absent: 0,
    leave: 0, offDay: 0, holiday: 0, onDuty: 0, specialPaid: 0,
    informed: 0, deductionDays: 0,
  };
  for (const d of days) {
    switch (d.status) {
      case 'PRESENT': summary.present++; break;
      case 'LATE': summary.late++; summary.present++; break; // late is still a present day
      case 'HALF_DAY': summary.halfDay++; break;
      case 'ABSENT': summary.absent++; break;
      case 'LEAVE': summary.leave++; break;
      case 'OFF_DAY': summary.offDay++; break;
      case 'HOLIDAY': summary.holiday++; break;
      case 'ON_DUTY': summary.onDuty++; break;
      case 'SPECIAL_PAID': summary.specialPaid++; break;
    }
    if (d.isInformed) summary.informed++;
    summary.deductionDays += Number(d.deductionDays) || 0;
  }
  summary.deductionDays = Number(summary.deductionDays.toFixed(2));

  return res.json({
    ok: true,
    linked: true,
    month,
    employee: {
      name: emp.name, hrCode: emp.hrCode, department: emp.department,
      designation: emp.designation, shiftIn: emp.shiftIn, shiftOut: emp.shiftOut,
      weeklyOffDay: emp.weeklyOffDay,
    },
    summary,
    days,
  });
}
