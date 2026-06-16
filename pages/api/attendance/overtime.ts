// ============================================================
// /api/attendance/overtime — the month-end overtime sheet.
// ============================================================
// GET ?month=YYYY-MM
//   → one row per employee who worked any weekly-off / holiday in the
//     month, with the count of overtime DAYS and the actual dates.
//     (Owner rule 2026-06-16: overtime is counted in whole days, not
//      hours. A day worked on an off/holiday stays paid as off/holiday
//      AND counts as one overtime day — see lib/attendance-classify.ts.)
//
// Reads the live per-day "isOvertime" flag, so it works for both open
// and finalized months and always reflects the true attendance on file.
//
// HR data → owner / admin / hr (the 'overtime' view).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { monthRange } from '@/lib/payroll';

type OtDay = { date: string; status: string };
type OtRow = {
  employeeId: string;
  name: string;
  hrCode: string;
  department: string | null;
  otDays: number;
  dates: OtDay[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'overtime')) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ ok: false, error: 'month query param (YYYY-MM) required' });
  }
  const { start, end } = monthRange(month);

  // One JOIN, ordered so we can group sequentially in memory.
  const rows = await query<any>(
    `SELECT e.id AS "employeeId", e.name, e."hrCode", e.department,
            d.date, d.status
       FROM "DailyAttendance" d
       JOIN "Employee" e ON e.id = d."employeeId"
      WHERE d."isOvertime" = TRUE AND d.date >= $1 AND d.date < $2
      ORDER BY e.department NULLS LAST, e.name, d.date`,
    [start, end],
  );

  const byEmp = new Map<string, OtRow>();
  for (const r of rows) {
    let row = byEmp.get(r.employeeId);
    if (!row) {
      row = { employeeId: r.employeeId, name: r.name, hrCode: r.hrCode, department: r.department, otDays: 0, dates: [] };
      byEmp.set(r.employeeId, row);
    }
    const iso = typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10);
    row.dates.push({ date: iso, status: r.status });
    row.otDays++;
  }

  const result = Array.from(byEmp.values());
  const totalOtDays = result.reduce((s, r) => s + r.otDays, 0);
  return res.json({ ok: true, month, rows: result, totalOtDays });
}
