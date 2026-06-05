// ============================================================
// /api/attendance/daily — read + manually override a day's records.
// ============================================================
// GET  ?date=YYYY-MM-DD  → all employees' attendance for that date,
//                          joined with employee name/department.
// PATCH { id, ... } → manual override. The owner can override ANY rule:
//        status, the informed/green flag, remark, the IN/OUT punch times,
//        and even the day-fraction deduction the engine computed. Any
//        override sets overridden=TRUE so future re-uploads won't clobber
//        the human call.
//        Convenience: { excusePaid:true } excuses the day as paid leave
//        (status SPECIAL_PAID, informed, zero deduction) in one shot.
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

// "HH:mm" or "HH:mm:ss" (24h) — or empty string to clear the punch.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const timeField = z
  .string()
  .max(8)
  .refine((s) => s === '' || TIME_RE.test(s), 'Use HH:mm (24-hour)')
  .optional()
  .nullable();

const Patch = z.object({
  id: z.string().min(1),
  status: z.enum(VALID_STATUS).optional(),
  isInformed: z.boolean().optional(),
  remark: z.string().max(500).optional(),
  actualIn: timeField,
  actualOut: timeField,
  deductionDays: z.number().min(0).max(1).optional(),
  excusePaid: z.boolean().optional(),
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
    const p = parsed.data;
    const existing = await queryOne<any>(`SELECT * FROM "DailyAttendance" WHERE id = $1`, [p.id]);
    if (!existing) return res.status(404).json({ ok: false, error: 'Record not found' });

    // One-click "excuse as paid leave": absent/half/late → fully paid, informed.
    const excuse = p.excusePaid === true;

    const newStatus = excuse ? 'SPECIAL_PAID' : (p.status ?? existing.status);
    const newInformed = excuse ? true : (p.isInformed ?? existing.isInformed);

    // Punch times: '' clears, undefined leaves as-is, a value sets it.
    const newIn = p.actualIn === undefined ? existing.actualIn : (p.actualIn || null);
    const newOut = p.actualOut === undefined ? existing.actualOut : (p.actualOut || null);

    // Deduction precedence: an explicit number wins; excuse forces 0; else the
    // status' raw deduction; else keep what was there.
    const deduction = excuse
      ? 0
      : p.deductionDays !== undefined
        ? p.deductionDays
        : (RAW_DEDUCTION[newStatus] ?? existing.deductionDays);

    await query(
      `UPDATE "DailyAttendance" SET
         status = $1,
         "isInformed" = $2,
         remark = COALESCE($3, remark),
         "actualIn" = $4,
         "actualOut" = $5,
         "deductionDays" = $6,
         overridden = TRUE,
         "overrideBy" = $7,
         "overrideAt" = NOW(),
         source = 'manual',
         "updatedAt" = NOW()
       WHERE id = $8`,
      [newStatus, newInformed, p.remark ?? null, newIn, newOut, deduction, user.name, p.id],
    );

    audit(req, user, excuse ? 'ATTENDANCE_EXCUSE_PAID' : 'ATTENDANCE_OVERRIDE', p.id, {
      from: existing.status, to: newStatus, isInformed: newInformed,
      actualIn: newIn, actualOut: newOut, deductionDays: deduction, remark: p.remark,
    });
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
