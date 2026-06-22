// ============================================================
// /api/attendance/payroll — monthly salary run.
// ============================================================
// GET  ?month=YYYY-MM
//        → per-employee payroll for the month. Finalized months are
//          returned from the stored MonthlyPayroll snapshot; open
//          months are computed live (a PREVIEW that touches nothing).
//
// POST { month, action:'finalize' }
//        → recompute the open employees for the month and PERSIST:
//          a MonthlyPayroll row each, advance installments recorded +
//          deducted from the advance balance, and the FY leave balance
//          updated. Idempotent: already-finalized employees are skipped,
//          and an advance is only ever deducted once per month.
//
// Salary is sensitive, so this rides the 'employees' view
// (owner / admin / hr). Finalize additionally needs edit rights.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, withTransaction, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import {
  computePayroll, daysInCalendarMonth, financialYearOf, monthRange,
  DEFAULT_LEAVE_ENTITLEMENT, type PayrollCounts,
} from '@/lib/payroll';
import { synthesizeMissing } from '@/lib/offsite';

// Server "today" in IST — offsite synthesis must not count future days.
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function istTodayIso(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}
function dateToIso(d: any): string {
  return typeof d === 'string' ? d.slice(0, 10)
    : `${new Date(d).getUTCFullYear()}-${String(new Date(d).getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(d).getUTCDate()).padStart(2, '0')}`;
}

function tally(rows: { status: string; isOvertime?: boolean }[]): PayrollCounts {
  const c: PayrollCounts = {
    present: 0, late: 0, halfDay: 0, absent: 0, leave: 0,
    offDay: 0, holiday: 0, onDuty: 0, specialPaid: 0, overtime: 0,
  };
  for (const r of rows) {
    switch (r.status) {
      case 'PRESENT': c.present++; break;
      case 'LATE': c.present++; c.late++; break;   // late is still a present day
      case 'HALF_DAY': c.halfDay++; break;
      case 'ABSENT': c.absent++; break;
      case 'LEAVE': c.leave++; break;
      case 'OFF_DAY': c.offDay++; break;
      case 'HOLIDAY': c.holiday++; break;
      case 'ON_DUTY': c.onDuty++; break;
      case 'SPECIAL_PAID': c.specialPaid++; break;
    }
    // Overtime is orthogonal to status: an OFF_DAY/HOLIDAY that was worked
    // stays counted as off/holiday for pay AND tallies one overtime day.
    if (r.isOvertime) c.overtime++;
  }
  return c;
}

function entitlementOf(emp: any): number {
  const carry = emp.leavesCarryOver ? Number(emp.carryOverDays || 0) : 0;
  return DEFAULT_LEAVE_ENTITLEMENT + carry;
}

type EmpBundle = {
  emp: any;
  counts: PayrollCounts;
  priorLeaveDaysInFY: number;
  totalLeaveDaysFYToDate: number;
  entitlement: number;
};

// Load everything needed to compute the month for every active employee
// (one query per concern, grouped in memory — no N+1).
async function gather(month: string): Promise<EmpBundle[]> {
  const { start, end } = monthRange(month);
  const fy = financialYearOf(month);

  const employees = await query<any>(
    `SELECT id, name, "hrCode", department, designation, "monthlySalary",
            "leavesCarryOver", "carryOverDays", "attendanceMode", "weeklyOffDay", "joiningDate"
       FROM "Employee" WHERE active = TRUE ORDER BY department NULLS LAST, name`,
  );
  if (employees.length === 0) return [];

  const monthRows = await query<any>(
    `SELECT "employeeId", date, status, "isOvertime" FROM "DailyAttendance"
      WHERE date >= $1 AND date < $2`,
    [start, end],
  );
  // LEAVE days earlier in the FY (before this month) — caps paid leave.
  const priorLeave = await query<any>(
    `SELECT "employeeId", COUNT(*)::int AS n FROM "DailyAttendance"
      WHERE status = 'LEAVE' AND date >= $1 AND date < $2
      GROUP BY "employeeId"`,
    [fy.start, fy.monthStart],
  );
  // LEAVE days FY-to-date INCLUDING this month — for the leave-balance row.
  const ytdLeave = await query<any>(
    `SELECT "employeeId", COUNT(*)::int AS n FROM "DailyAttendance"
      WHERE status = 'LEAVE' AND date >= $1 AND date < $2
      GROUP BY "employeeId"`,
    [fy.start, end],
  );

  const rowsByEmp = new Map<string, any[]>();
  const rowDatesByEmp = new Map<string, Set<string>>();
  for (const r of monthRows) {
    if (!rowsByEmp.has(r.employeeId)) rowsByEmp.set(r.employeeId, []);
    rowsByEmp.get(r.employeeId)!.push(r);
    if (!rowDatesByEmp.has(r.employeeId)) rowDatesByEmp.set(r.employeeId, new Set());
    rowDatesByEmp.get(r.employeeId)!.add(dateToIso(r.date));
  }
  const priorByEmp = new Map(priorLeave.map(r => [r.employeeId, r.n]));
  const ytdByEmp = new Map(ytdLeave.map(r => [r.employeeId, r.n]));

  // ── Offsite auto-absent ──────────────────────────────────────────
  // Offsite staff never appear in the biometric file, so their only rows
  // are self check-ins. Every ELAPSED working day with no row is a missed
  // (ABSENT) day; weekly-offs/holidays stay paid, declared leaves stay
  // leave, future days don't count. Synthesized in-memory so the preview
  // still writes nothing. (Cross-FY paid-leave cap for offsite leans on
  // the LeaveBalance drawn at declaration time, since there are no LEAVE
  // rows to count here.)
  const daysInMonth = daysInCalendarMonth(month);
  const todayIso = istTodayIso();
  const offsiteIds = employees.filter(e => e.attendanceMode === 'offsite').map(e => e.id);
  const holidaySet = new Set<string>();
  const leaveByEmpDate = new Map<string, Map<string, 'FULL' | 'HALF'>>();
  if (offsiteIds.length > 0) {
    const hols = await query<any>(`SELECT date FROM "Holiday" WHERE date >= $1 AND date < $2`, [start, end]);
    for (const h of hols) holidaySet.add(dateToIso(h.date));
    const leaves = await query<any>(
      `SELECT "employeeId", "fromDate", "toDate", kind FROM "LeaveRequest"
        WHERE status = 'APPROVED' AND "employeeId" = ANY($1::text[])
          AND "fromDate" < $3 AND "toDate" >= $2`,
      [offsiteIds, start, end],
    );
    const [yy, mm] = month.split('-').map(Number);
    for (const l of leaves) {
      const kind = l.kind === 'HALF_DAY' ? 'HALF' : (l.kind === 'FULL_DAY' ? 'FULL' : null);
      if (!kind) continue;
      const from = dateToIso(l.fromDate), to = dateToIso(l.toDate);
      let m = leaveByEmpDate.get(l.employeeId);
      if (!m) { m = new Map(); leaveByEmpDate.set(l.employeeId, m); }
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${yy}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (iso >= from && iso <= to) m.set(iso, kind as 'FULL' | 'HALF');
      }
    }
  }

  return employees.map(emp => {
    const counts = tally(rowsByEmp.get(emp.id) || []);
    if (emp.attendanceMode === 'offsite') {
      const miss = synthesizeMissing({
        monthStart: start,
        daysInMonth,
        weeklyOffDay: Number(emp.weeklyOffDay) || 0,
        holidays: holidaySet,
        rowDates: rowDatesByEmp.get(emp.id) || new Set(),
        leaveDates: leaveByEmpDate.get(emp.id) || new Map(),
        todayIso,
        joiningIso: emp.joiningDate ? dateToIso(emp.joiningDate) : null,
      });
      counts.absent += miss.absent;
      counts.offDay += miss.offDay;
      counts.holiday += miss.holiday;
      counts.leave += miss.leave;
      counts.halfDay += miss.halfDay;
    }
    return {
      emp,
      counts,
      priorLeaveDaysInFY: priorByEmp.get(emp.id) || 0,
      totalLeaveDaysFYToDate: ytdByEmp.get(emp.id) || 0,
      entitlement: entitlementOf(emp),
    };
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'employees')) return;

  if (req.method === 'GET') return preview(req, res);
  if (req.method === 'POST') {
    if (!requireViewEdit(user, res, 'employees')) return;
    return finalize(req, res, user);
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

// ─── GET — preview (open months) / snapshot (finalized) ──────────
async function preview(req: NextApiRequest, res: NextApiResponse) {
  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ ok: false, error: 'month query param (YYYY-MM) required' });
  }
  const daysInMonth = daysInCalendarMonth(month);
  const bundles = await gather(month);
  if (bundles.length === 0) return res.json({ ok: true, month, daysInMonth, rows: [] });

  const empIds = bundles.map(b => b.emp.id);

  // Stored finalized snapshots (immutable once finalized).
  const stored = await query<any>(
    `SELECT * FROM "MonthlyPayroll" WHERE month = $1 AND "employeeId" = ANY($2::text[])`,
    [month, empIds],
  );
  const storedByEmp = new Map(stored.map(s => [s.employeeId, s]));

  // Active advance installments scheduled for this month (for open-month
  // previews only — finalized rows already carry the recorded amount).
  const advances = await query<any>(
    `SELECT "employeeId", id, "monthlyInstallment", "remainingBalance"
       FROM "Advance"
      WHERE active = TRUE AND "remainingBalance" > 0 AND "startMonth" <= $1
        AND "employeeId" = ANY($2::text[])`,
    [month, empIds],
  );
  const advDueByEmp = new Map<string, number>();
  for (const a of advances) {
    const due = Math.min(Number(a.monthlyInstallment), Number(a.remainingBalance));
    advDueByEmp.set(a.employeeId, (advDueByEmp.get(a.employeeId) || 0) + due);
  }

  const rows = bundles.map(b => {
    const snap = storedByEmp.get(b.emp.id);
    if (snap && snap.finalized) {
      return {
        employeeId: b.emp.id, name: b.emp.name, hrCode: b.emp.hrCode,
        department: b.emp.department, designation: b.emp.designation,
        monthlySalary: Number(b.emp.monthlySalary),
        finalized: true,
        result: {
          daysInMonth: snap.daysInMonth, presentDays: Number(snap.presentDays),
          halfDays: Number(snap.halfDays), paidLeaves: Number(snap.paidLeaves),
          excessLeaves: 0, lwpDays: Number(snap.lwpDays),
          paidHolidays: Number(snap.paidHolidays), weeklyOffs: Number(snap.weeklyOffs),
          onDutyDays: Number(snap.onDutyDays), overtimeDays: Number(snap.overtimeDays || 0),
          lateCount: snap.lateCount,
          lateDeductionDays: Number(snap.lateDeductionDays),
          deductionDays: Number(snap.daysInMonth) - Number(snap.netPayableDays),
          netPayableDays: Number(snap.netPayableDays), perDaySalary: Number(snap.perDaySalary),
          grossSalary: Number(snap.grossSalary), advanceDeduction: Number(snap.advanceDeduction),
          netSalary: Number(snap.netSalary),
        },
        leaveBalance: Math.max(0, b.entitlement - b.totalLeaveDaysFYToDate),
      };
    }
    const result = computePayroll({
      monthlySalary: Number(b.emp.monthlySalary),
      daysInMonth,
      counts: b.counts,
      leaveEntitlement: b.entitlement,
      priorLeaveDaysInFY: b.priorLeaveDaysInFY,
      advanceInstallmentDue: advDueByEmp.get(b.emp.id) || 0,
    });
    return {
      employeeId: b.emp.id, name: b.emp.name, hrCode: b.emp.hrCode,
      department: b.emp.department, designation: b.emp.designation,
      monthlySalary: Number(b.emp.monthlySalary),
      finalized: false,
      result,
      leaveBalance: Math.max(0, b.entitlement - b.totalLeaveDaysFYToDate),
    };
  });

  return res.json({ ok: true, month, daysInMonth, rows });
}

// ─── POST — finalize (persist) ───────────────────────────────────
const FinalizeBody = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  action: z.literal('finalize'),
  employeeId: z.string().optional(), // finalize one; omit = all open
});

async function finalize(req: NextApiRequest, res: NextApiResponse, user: any) {
  const parsed = FinalizeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
  const { month, employeeId } = parsed.data;

  const daysInMonth = daysInCalendarMonth(month);
  const fy = financialYearOf(month);
  let bundles = await gather(month);
  if (employeeId) bundles = bundles.filter(b => b.emp.id === employeeId);
  if (bundles.length === 0) return res.json({ ok: true, month, finalized: 0, skipped: 0 });

  const empIds = bundles.map(b => b.emp.id);
  const already = await query<any>(
    `SELECT "employeeId" FROM "MonthlyPayroll"
      WHERE month = $1 AND finalized = TRUE AND "employeeId" = ANY($2::text[])`,
    [month, empIds],
  );
  const finalizedSet = new Set(already.map(a => a.employeeId));

  let finalizedCount = 0;
  let skipped = 0;

  for (const b of bundles) {
    if (finalizedSet.has(b.emp.id)) { skipped++; continue; }

    await withTransaction(async (q) => {
      // Advances due this month, not already recorded — record + deduct.
      const advs = await q(
        `SELECT a.id, a."monthlyInstallment", a."remainingBalance"
           FROM "Advance" a
          WHERE a."employeeId" = $1 AND a.active = TRUE
            AND a."remainingBalance" > 0 AND a."startMonth" <= $2
            AND NOT EXISTS (
              SELECT 1 FROM "AdvanceDeduction" d
               WHERE d."advanceId" = a.id AND d.month = $2)`,
        [b.emp.id, month],
      );
      let advanceDue = 0;
      for (const a of advs) {
        const amount = Math.min(Number(a.monthlyInstallment), Number(a.remainingBalance));
        if (amount <= 0) continue;
        advanceDue += amount;
        await q(
          `INSERT INTO "AdvanceDeduction" (id, "advanceId", "employeeId", month, amount)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("advanceId", month) DO NOTHING`,
          [newId('advded'), a.id, b.emp.id, month, amount],
        );
        const newBal = Number(a.remainingBalance) - amount;
        await q(
          `UPDATE "Advance" SET "remainingBalance" = $1, active = $2, "updatedAt" = NOW()
            WHERE id = $3`,
          [newBal, newBal > 0, a.id],
        );
      }

      const result = computePayroll({
        monthlySalary: Number(b.emp.monthlySalary),
        daysInMonth,
        counts: b.counts,
        leaveEntitlement: b.entitlement,
        priorLeaveDaysInFY: b.priorLeaveDaysInFY,
        advanceInstallmentDue: advanceDue,
      });

      await q(
        `INSERT INTO "MonthlyPayroll" (
           id, "employeeId", month, "daysInMonth", "presentDays", "halfDays",
           "paidLeaves", "lwpDays", "paidHolidays", "weeklyOffs", "onDutyDays",
           "lateCount", "lateDeductionDays", "netPayableDays", "perDaySalary",
           "grossSalary", "advanceDeduction", "netSalary", "overtimeDays",
           finalized, "finalizedBy", "finalizedAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,TRUE,$20,NOW(),NOW())
         ON CONFLICT ("employeeId", month) DO UPDATE SET
           "daysInMonth"=$4, "presentDays"=$5, "halfDays"=$6, "paidLeaves"=$7,
           "lwpDays"=$8, "paidHolidays"=$9, "weeklyOffs"=$10, "onDutyDays"=$11,
           "lateCount"=$12, "lateDeductionDays"=$13, "netPayableDays"=$14,
           "perDaySalary"=$15, "grossSalary"=$16, "advanceDeduction"=$17,
           "netSalary"=$18, "overtimeDays"=$19, finalized=TRUE, "finalizedBy"=$20,
           "finalizedAt"=NOW(), "updatedAt"=NOW()`,
        [
          newId('pay'), b.emp.id, month, result.daysInMonth, result.presentDays,
          result.halfDays, result.paidLeaves, result.lwpDays, result.paidHolidays,
          result.weeklyOffs, result.onDutyDays, result.lateCount, result.lateDeductionDays,
          result.netPayableDays, result.perDaySalary, result.grossSalary,
          result.advanceDeduction, result.netSalary, result.overtimeDays, user.name,
        ],
      );

      // FY leave balance snapshot.
      const used = b.totalLeaveDaysFYToDate;
      const remaining = Math.max(0, b.entitlement - used);
      await q(
        `INSERT INTO "LeaveBalance" (id, "employeeId", "financialYear", opening, used, remaining, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT ("employeeId", "financialYear") DO UPDATE SET
           opening=$4, used=$5, remaining=$6, "updatedAt"=NOW()`,
        [newId('lvbal'), b.emp.id, fy.label, b.entitlement, used, remaining],
      );
    });

    finalizedCount++;
  }

  audit(req, user, 'PAYROLL_FINALIZE', month, { finalized: finalizedCount, skipped });
  return res.json({ ok: true, month, finalized: finalizedCount, skipped });
}
