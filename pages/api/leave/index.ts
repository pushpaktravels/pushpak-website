// ============================================================
// /api/leave — self-service leave (NO approval step).
// ============================================================
// GET  → the caller's OWN leaves for a financial year + their paid-leave
//        balance. Hard-scoped to self via the linked Employee row.
// POST → declare a leave for YOURSELF. It is recorded as already-approved
//        (there is no approver), immediately reflected onto any attendance
//        already on file for those dates, and — for full / half days —
//        drawn down from the paid-leave balance.
//
// Every logged-in employee can use this; it never reads or writes anyone
// else's record (the employee is derived from the session, never a param).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { financialYearOf } from '@/lib/attendance-db';
import { LEAVE_KINDS, type LeaveKindSS } from '@/lib/leave';
import { planLeave, recordLeave } from '@/lib/leave-engine';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  kind:     z.enum(LEAVE_KINDS),
  fromDate: z.string().regex(ISO, 'fromDate must be YYYY-MM-DD'),
  toDate:   z.string().regex(ISO).optional(),
  reason:   z.string().max(500).optional().nullable(),
  note:     z.string().max(500).optional().nullable(),
});

async function findEmployee(execId: string) {
  return queryOne<any>(
    `SELECT id, name, "hrCode", department FROM "Employee"
      WHERE "loginExecId" = $1 AND active = TRUE`,
    [execId],
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const emp = await findEmployee(user.execId);
  if (!emp) {
    if (req.method === 'GET') return res.json({ ok: true, linked: false, leaves: [], balance: null });
    return res.status(400).json({ ok: false, error: "Your login isn't linked to an employee yet. Ask the owner to link it." });
  }

  if (req.method === 'GET') return list(req, res, emp);
  if (req.method === 'POST') return create(req, res, user, emp);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse, emp: any) {
  const fy = /^\d{4}-\d{4}$/.test(String(req.query.fy || ''))
    ? String(req.query.fy)
    : financialYearOf(new Date());

  // Leaves whose start falls in the requested financial year (Apr–Mar).
  const [y1] = fy.split('-').map(Number);
  const fyStart = `${y1}-04-01`;
  const fyEnd = `${y1 + 1}-03-31`;

  const leaves = await query<any>(
    `SELECT id, "fromDate", "toDate", days, kind, reason, notes, status, "createdAt"
       FROM "LeaveRequest"
      WHERE "employeeId" = $1 AND "fromDate" >= $2 AND "fromDate" <= $3
      ORDER BY "fromDate" DESC, "createdAt" DESC`,
    [emp.id, fyStart, fyEnd],
  );
  const balance = await queryOne<any>(
    `SELECT opening, used, remaining FROM "LeaveBalance"
      WHERE "employeeId" = $1 AND "financialYear" = $2`,
    [emp.id, fy],
  );

  return res.json({
    ok: true, linked: true, fy,
    employee: { name: emp.name, hrCode: emp.hrCode, department: emp.department },
    balance: balance || { opening: 18, used: 0, remaining: 18 },
    leaves,
  });
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any, emp: any) {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const planned = planLeave(b.kind as LeaveKindSS, b.fromDate, b.toDate);
  if (!planned.ok) return res.status(400).json({ ok: false, error: planned.error });
  const plan = planned.plan;

  try {
    // Self-service: the author recorded on the request is the employee.
    const { id, daysTouched } = await recordLeave({
      employeeId: emp.id, plan, reason: b.reason, appliedBy: user.name, note: b.note,
    });

    audit(req, user, 'LEAVE_DECLARE', emp.name, {
      id, kind: plan.kind, fromDate: plan.fromDate, toDate: plan.toDate, days: plan.days, balanceCost: plan.balanceCost,
    });
    return res.json({
      ok: true,
      data: { id, kind: plan.kind, fromDate: plan.fromDate, toDate: plan.toDate, days: plan.days, balanceCost: plan.balanceCost, daysTouched },
    });
  } catch (err: any) {
    console.error('[api/leave] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Could not record leave' });
  }
}
