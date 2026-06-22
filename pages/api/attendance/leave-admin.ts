// ============================================================
// /api/attendance/leave-admin — HR records leave ON BEHALF of staff.
// ============================================================
// Some staff (support / field people) can't run the self-service "My
// Leave" page themselves, so HR records their time off for them. Same
// engine as self-service so the numbers can never drift: the leave is
// stored already-approved, drives the attendance engine (marks the days
// informed + LEAVE / HALF_DAY) and draws the paid-leave balance down —
// the only differences are HR picks WHICH employee, and "appliedBy"
// records that HR filed it (the on-behalf audit trail).
//
// For an OFFSITE employee a recorded FULL / HALF leave is what turns an
// otherwise auto-absent day into a paid leave: payroll and the Offsite
// review read these LeaveRequest rows (there are no attendance rows on a
// missed offsite day). For an office employee it updates the day rows
// already on file, exactly like self-service.
//
// Gated to owner / admin / hr (view 'leave-admin'); mutations also pass
// requireViewEdit, so a view-only HR user can look but not change.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { financialYearOf } from '@/lib/attendance-db';
import { LEAVE_KINDS, type LeaveKindSS } from '@/lib/leave';
import { planLeave, recordLeave, cancelLeaveRecord } from '@/lib/leave-engine';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  employeeId: z.string().min(1),
  kind:       z.enum(LEAVE_KINDS),
  fromDate:   z.string().regex(ISO, 'fromDate must be YYYY-MM-DD'),
  toDate:     z.string().regex(ISO).optional(),
  reason:     z.string().max(500).optional().nullable(),
  note:       z.string().max(500).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'leave-admin')) return;

  if (req.method === 'GET') return listEmployeesAndLeaves(req, res);

  // Everything past here mutates — honour a view-only HR grant.
  if (!requireViewEdit(user, res, 'leave-admin')) return;
  if (req.method === 'POST') return create(req, res, user);
  if (req.method === 'DELETE') return cancel(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

// GET — the employee picker, plus (when ?employeeId= is set) that one
// employee's leaves for the financial year and their paid-leave balance.
async function listEmployeesAndLeaves(req: NextApiRequest, res: NextApiResponse) {
  const employees = await query<any>(
    `SELECT id, name, "hrCode", department, "attendanceMode"
       FROM "Employee" WHERE active = TRUE ORDER BY name ASC`,
  );

  const employeeId = String(req.query.employeeId || '');
  let detail: any = null;
  if (employeeId) {
    const emp = employees.find((e) => e.id === employeeId);
    if (emp) {
      const fy = /^\d{4}-\d{4}$/.test(String(req.query.fy || ''))
        ? String(req.query.fy)
        : financialYearOf(new Date());
      const [y1] = fy.split('-').map(Number);
      const fyStart = `${y1}-04-01`;
      const fyEnd = `${y1 + 1}-03-31`;

      const leaves = await query<any>(
        `SELECT id, "fromDate", "toDate", days, kind, reason, notes, status, "appliedBy", "createdAt"
           FROM "LeaveRequest"
          WHERE "employeeId" = $1 AND "fromDate" >= $2 AND "fromDate" <= $3
          ORDER BY "fromDate" DESC, "createdAt" DESC`,
        [employeeId, fyStart, fyEnd],
      );
      const balance = await queryOne<any>(
        `SELECT opening, used, remaining FROM "LeaveBalance"
          WHERE "employeeId" = $1 AND "financialYear" = $2`,
        [employeeId, fy],
      );
      detail = {
        fy,
        employee: emp,
        balance: balance || { opening: 18, used: 0, remaining: 18 },
        leaves,
      };
    }
  }

  return res.json({ ok: true, employees, detail });
}

// POST — record a leave for the chosen employee. Mirrors the self-service
// create() exactly (same balance maths, same engine call) but on the
// target employee, with HR stamped as the author.
async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const emp = await queryOne<any>(
    `SELECT id, name, "hrCode" FROM "Employee" WHERE id = $1 AND active = TRUE`,
    [b.employeeId],
  );
  if (!emp) return res.status(404).json({ ok: false, error: 'Employee not found or inactive.' });

  const planned = planLeave(b.kind as LeaveKindSS, b.fromDate, b.toDate);
  if (!planned.ok) return res.status(400).json({ ok: false, error: planned.error });
  const plan = planned.plan;

  // The on-behalf trail: the leave's author is HR, not the employee.
  const appliedBy = `${user.name} (HR)`;
  const note = b.note || `Recorded by ${user.name} on the employee's behalf.`;

  try {
    const { id, daysTouched } = await recordLeave({
      employeeId: emp.id, plan, reason: b.reason, appliedBy, note,
    });

    audit(req, user, 'LEAVE_DECLARE_ONBEHALF', emp.name, {
      id, kind: plan.kind, fromDate: plan.fromDate, toDate: plan.toDate, days: plan.days, balanceCost: plan.balanceCost,
    });
    return res.json({
      ok: true,
      data: { id, kind: plan.kind, fromDate: plan.fromDate, toDate: plan.toDate, days: plan.days, balanceCost: plan.balanceCost, daysTouched },
    });
  } catch (err: any) {
    console.error('[api/attendance/leave-admin] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Could not record leave' });
  }
}

// DELETE — withdraw a leave HR recorded (or any leave). Credits the paid
// balance back and re-classifies the affected days from the punches on
// file, mirroring the self-service cancel — but not scoped to self.
async function cancel(req: NextApiRequest, res: NextApiResponse, user: any) {
  const id = String(req.query.id || (req.body && req.body.id) || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const lv = await queryOne<any>(`SELECT * FROM "LeaveRequest" WHERE id = $1 LIMIT 1`, [id]);
  if (!lv) return res.status(404).json({ ok: false, error: 'Leave not found' });

  const emp = await queryOne<any>(
    `SELECT id, name, "machineCode", "hrCode", "weeklyOffDay", "shiftIn", "shiftOut"
       FROM "Employee" WHERE id = $1`,
    [lv.employeeId],
  );
  if (!emp) return res.status(404).json({ ok: false, error: 'Employee not found' });

  try {
    // Same engine as self-service cancel; HR is not scoped to self, so any
    // leave can be withdrawn. Credits the balance back + re-classifies days.
    const { kind, fromIso, toIso, balanceCredit } = await cancelLeaveRecord({
      leave: lv,
      employee: {
        id: emp.id, machineCode: emp.machineCode, hrCode: emp.hrCode, name: emp.name,
        weeklyOffDay: emp.weeklyOffDay, shiftIn: emp.shiftIn, shiftOut: emp.shiftOut,
      },
    });

    audit(req, user, 'LEAVE_CANCEL_ONBEHALF', emp.name, { id, kind, fromIso, toIso, balanceCredit });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[api/attendance/leave-admin] cancel error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Could not cancel leave' });
  }
}
