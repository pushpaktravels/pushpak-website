// ============================================================
// /api/attendance/daily — read + manually override a day's records.
// ============================================================
// GET  ?date=YYYY-MM-DD  → all employees' attendance for that date,
//                          joined with employee name/department.
// PATCH { id, status?, isInformed?, remark? } → manual override; sets
//        overridden=TRUE so future re-uploads won't clobber the human
//        call (leave / holiday / on-duty corrections, green flag).
//
// Auth: owner / admin only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const VALID_STATUS = [
  'PRESENT', 'LATE', 'HALF_DAY', 'ABSENT',
  'LEAVE', 'OFF_DAY', 'HOLIDAY', 'ON_DUTY', 'SPECIAL_PAID',
] as const;

// day-fraction lost per status (before late-tiering / leave offset)
const RAW_DEDUCTION: Record<string, number> = {
  PRESENT: 0, LATE: 0, ON_DUTY: 0, OFF_DAY: 0, HOLIDAY: 0,
  LEAVE: 0, SPECIAL_PAID: 0, HALF_DAY: 0.5, ABSENT: 1,
};

const Patch = z.object({
  id: z.string().min(1),
  status: z.enum(VALID_STATUS).optional(),
  isInformed: z.boolean().optional(),
  remark: z.string().max(500).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'attendance')) return;

  if (req.method === 'GET') {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: 'date query param (YYYY-MM-DD) required' });
    }
    const rows = await query(
      `SELECT a.id, a."employeeId", a."machineCode", a.date,
              a."scheduledIn", a."scheduledOut", a."actualIn", a."actualOut",
              a."lateByMin", a."earlyGoingMin", a."workDurMin",
              a.status, a."isInformed", a."deductionDays", a.remark, a.source,
              a.overridden, a."overrideBy", a."overrideAt",
              e.name, e."hrCode", e.department, e.designation
         FROM "DailyAttendance" a
         JOIN "Employee" e ON e.id = a."employeeId"
        WHERE a.date = $1
        ORDER BY e.department NULLS LAST, e.name`,
      [date],
    );
    return res.json({ ok: true, date, rows });
  }

  if (req.method === 'PATCH') {
    if (!requireViewEdit(user, res, 'attendance')) return;
    const parsed = Patch.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    }
    const { id, status, isInformed, remark } = parsed.data;
    const existing = await queryOne<any>(`SELECT * FROM "DailyAttendance" WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ ok: false, error: 'Record not found' });

    const newStatus = status ?? existing.status;
    const deduction = RAW_DEDUCTION[newStatus] ?? existing.deductionDays;

    await query(
      `UPDATE "DailyAttendance" SET
         status = $1,
         "isInformed" = $2,
         remark = COALESCE($3, remark),
         "deductionDays" = $4,
         overridden = TRUE,
         "overrideBy" = $5,
         "overrideAt" = NOW(),
         source = 'manual',
         "updatedAt" = NOW()
       WHERE id = $6`,
      [newStatus, isInformed ?? existing.isInformed, remark ?? null, deduction, user.name, id],
    );

    audit(req, user, 'ATTENDANCE_OVERRIDE', id, {
      from: existing.status, to: newStatus, isInformed, remark,
    });
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
