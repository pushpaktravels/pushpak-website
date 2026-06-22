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
import { query, queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import {
  financialYearOf, isoToUtcDate, applyDeclarationToDays, reclassifyDays, type EmployeeRow,
} from '@/lib/attendance-db';
import { LEAVE_KINDS, balancePerDay, isSingleDayKind, type LeaveKindSS } from '@/lib/leave';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  employeeId: z.string().min(1),
  kind:       z.enum(LEAVE_KINDS),
  fromDate:   z.string().regex(ISO, 'fromDate must be YYYY-MM-DD'),
  toDate:     z.string().regex(ISO).optional(),
  reason:     z.string().max(500).optional().nullable(),
  note:       z.string().max(500).optional().nullable(),
});

// Inclusive calendar-day count between two ISO dates.
function dayspan(fromIso: string, toIso: string): number {
  const a = isoToUtcDate(fromIso).getTime();
  const b = isoToUtcDate(toIso).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

function isoString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

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
  const kind = b.kind as LeaveKindSS;

  const emp = await queryOne<any>(
    `SELECT id, name, "hrCode" FROM "Employee" WHERE id = $1 AND active = TRUE`,
    [b.employeeId],
  );
  if (!emp) return res.status(404).json({ ok: false, error: 'Employee not found or inactive.' });

  const fromDate = b.fromDate;
  // Late-arrival / early-out are single-day by definition.
  const toDate = isSingleDayKind(kind) ? fromDate : (b.toDate || fromDate);
  if (toDate < fromDate) return res.status(400).json({ ok: false, error: 'End date is before start date.' });

  const numDays = dayspan(fromDate, toDate);
  if (numDays > 60) return res.status(400).json({ ok: false, error: 'That range is too long (max 60 days).' });

  const perDay = balancePerDay(kind);          // 1 / 0.5 / 0
  const days = kind === 'HALF_DAY' ? 0.5 : (kind === 'FULL_DAY' ? numDays : 0);
  const balanceCost = perDay * (kind === 'HALF_DAY' ? 1 : numDays);
  const fy = financialYearOf(isoToUtcDate(fromDate));

  // The on-behalf trail: the leave's author is HR, not the employee.
  const appliedBy = `${user.name} (HR)`;
  const note = b.note || `Recorded by ${user.name} on the employee's behalf.`;

  try {
    const id = newId('lv');
    const result = await withTransaction(async (q) => {
      await q(
        `INSERT INTO "LeaveRequest"
           (id, "employeeId", "fromDate", "toDate", days, reason, status, kind,
            "appliedBy", "decidedBy", "decidedAt", notes, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,'APPROVED',$7,$8,$8,NOW(),$9,NOW(),NOW())`,
        [id, emp.id, fromDate, toDate, days, b.reason || null, kind, appliedBy, note],
      );

      if (balanceCost > 0) {
        await q(
          `INSERT INTO "LeaveBalance" (id, "employeeId", "financialYear", opening, used, remaining, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,18,$4,18-$4,NOW(),NOW())
           ON CONFLICT ("employeeId","financialYear") DO UPDATE
             SET used = "LeaveBalance".used + $4,
                 remaining = "LeaveBalance".remaining - $4,
                 "updatedAt" = NOW()`,
          [newId('lbal'), emp.id, fy, balanceCost],
        );
      }

      const touched = await applyDeclarationToDays(q, emp.id, fromDate, toDate, kind);
      return { touched };
    });

    audit(req, user, 'LEAVE_DECLARE_ONBEHALF', emp.name, { id, kind, fromDate, toDate, days, balanceCost });
    return res.json({ ok: true, data: { id, kind, fromDate, toDate, days, balanceCost, daysTouched: result.touched } });
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

  const kind = lv.kind as LeaveKindSS;
  const fromIso = typeof lv.fromDate === 'string' ? lv.fromDate.slice(0, 10) : isoString(lv.fromDate);
  const toIso = typeof lv.toDate === 'string' ? lv.toDate.slice(0, 10) : isoString(lv.toDate);

  const days = Number(lv.days) || 0;
  const balanceCredit = balancePerDay(kind) > 0 ? days : 0;
  const fy = financialYearOf(isoToUtcDate(fromIso));

  try {
    await withTransaction(async (q) => {
      await q(`DELETE FROM "LeaveRequest" WHERE id = $1`, [id]);
      if (balanceCredit > 0) {
        await q(
          `UPDATE "LeaveBalance"
              SET used = GREATEST(used - $3, 0),
                  remaining = LEAST(opening, remaining + $3),
                  "updatedAt" = NOW()
            WHERE "employeeId" = $1 AND "financialYear" = $2`,
          [emp.id, fy, balanceCredit],
        );
      }
      const e: EmployeeRow = {
        id: emp.id, machineCode: emp.machineCode, hrCode: emp.hrCode, name: emp.name,
        weeklyOffDay: emp.weeklyOffDay, shiftIn: emp.shiftIn, shiftOut: emp.shiftOut,
      };
      await reclassifyDays(q, e, fromIso, toIso);
    });

    audit(req, user, 'LEAVE_CANCEL_ONBEHALF', emp.name, { id, kind, fromIso, toIso, balanceCredit });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[api/attendance/leave-admin] cancel error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Could not cancel leave' });
  }
}
