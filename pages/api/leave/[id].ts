// ============================================================
// DELETE /api/leave/[id] — cancel one of YOUR OWN declared leaves.
// ============================================================
// Self-service: an employee can withdraw a leave they entered. The paid
// balance it consumed is credited back, and any attendance days it had
// forced to LEAVE / HALF_DAY are re-classified from the punches on file
// (so a cancelled future leave doesn't leave a stale "on leave" day).
//
// Hard-scoped to self: the leave must belong to the caller's own Employee
// row, so nobody can cancel someone else's leave.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne, withTransaction } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { financialYearOf, isoToUtcDate, reclassifyDays, type EmployeeRow } from '@/lib/attendance-db';
import { balancePerDay, type LeaveKindSS } from '@/lib/leave';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const emp = await queryOne<any>(
    `SELECT id, name, "machineCode", "hrCode", "weeklyOffDay", "shiftIn", "shiftOut"
       FROM "Employee" WHERE "loginExecId" = $1 AND active = TRUE`,
    [user.execId],
  );
  if (!emp) return res.status(400).json({ ok: false, error: "Your login isn't linked to an employee." });

  const lv = await queryOne<any>(`SELECT * FROM "LeaveRequest" WHERE id = $1 LIMIT 1`, [id]);
  if (!lv) return res.status(404).json({ ok: false, error: 'Leave not found' });
  if (lv.employeeId !== emp.id) {
    return res.status(403).json({ ok: false, error: 'That leave is not yours to cancel.' });
  }

  const kind = lv.kind as LeaveKindSS;
  const fromIso = typeof lv.fromDate === 'string' ? lv.fromDate.slice(0, 10) : isoString(lv.fromDate);
  const toIso = typeof lv.toDate === 'string' ? lv.toDate.slice(0, 10) : isoString(lv.toDate);

  // How much balance to credit back: mirrors what create() drew down.
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

    audit(req, user, 'LEAVE_CANCEL', emp.name, { id, kind, fromIso, toIso, balanceCredit });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[api/leave/[id]] cancel error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Could not cancel leave' });
  }
}

function isoString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
