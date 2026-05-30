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
// ?month=YYYY-MM (defaults to the current month).
// Auth: any logged-in user.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

function monthRange(month: string): { start: string; end: string } {
  // start = first of month, end = first of next month (exclusive)
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end };
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
    `SELECT id, name, "hrCode", department, designation, "shiftIn", "shiftOut", "weeklyOffDay"
       FROM "Employee" WHERE "loginExecId" = $1 AND active = TRUE`,
    [user.execId],
  );
  if (!emp) {
    return res.json({ ok: true, linked: false, month });
  }

  const { start, end } = monthRange(month);
  const days = await query<any>(
    `SELECT date, status, "actualIn", "actualOut", "scheduledIn", "scheduledOut",
            "lateByMin", "earlyGoingMin", "isInformed", "deductionDays", remark
       FROM "DailyAttendance"
      WHERE "employeeId" = $1 AND date >= $2 AND date < $3
      ORDER BY date`,
    [emp.id, start, end],
  );

  // Tally the month. Counts mirror the status taxonomy; deduction is the
  // pay-day fraction lost (half day = 0.5, absent = 1, etc.).
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
