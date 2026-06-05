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
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { financialYearOf, isoToUtcDate, applyDeclarationToDays } from '@/lib/attendance-db';
import { LEAVE_KINDS, balancePerDay, isSingleDayKind, type LeaveKindSS } from '@/lib/leave';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  kind:     z.enum(LEAVE_KINDS),
  fromDate: z.string().regex(ISO, 'fromDate must be YYYY-MM-DD'),
  toDate:   z.string().regex(ISO).optional(),
  reason:   z.string().max(500).optional().nullable(),
  note:     z.string().max(500).optional().nullable(),
});

// Inclusive calendar-day count between two ISO dates.
function dayspan(fromIso: string, toIso: string): number {
  const a = isoToUtcDate(fromIso).getTime();
  const b = isoToUtcDate(toIso).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

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

  const { query } = await import('@/lib/pg');
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
  const kind = b.kind as LeaveKindSS;

  const fromDate = b.fromDate;
  // Late-arrival / early-out are single-day by definition.
  const toDate = isSingleDayKind(kind) ? fromDate : (b.toDate || fromDate);
  if (toDate < fromDate) return res.status(400).json({ ok: false, error: 'End date is before start date.' });

  const numDays = dayspan(fromDate, toDate);
  if (numDays > 60) return res.status(400).json({ ok: false, error: 'That range is too long (max 60 days).' });

  // Stored leave "days" + the paid-balance drawdown.
  const perDay = balancePerDay(kind);          // 1 / 0.5 / 0
  const days = kind === 'HALF_DAY' ? 0.5 : (kind === 'FULL_DAY' ? numDays : 0);
  const balanceCost = perDay * (kind === 'HALF_DAY' ? 1 : numDays);
  const fy = financialYearOf(isoToUtcDate(fromDate));

  try {
    const id = newId('lv');
    const result = await withTransaction(async (q) => {
      await q(
        `INSERT INTO "LeaveRequest"
           (id, "employeeId", "fromDate", "toDate", days, reason, status, kind,
            "appliedBy", "decidedBy", "decidedAt", notes, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,'APPROVED',$7,$8,$8,NOW(),$9,NOW(),NOW())`,
        [id, emp.id, fromDate, toDate, days, b.reason || null, kind, user.name, b.note || null],
      );

      // Draw down paid-leave balance for full / half days (create the FY row
      // at the standard 18-day opening if it doesn't exist yet).
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

    audit(req, user, 'LEAVE_DECLARE', emp.name, { id, kind, fromDate, toDate, days, balanceCost });
    return res.json({ ok: true, data: { id, kind, fromDate, toDate, days, balanceCost, daysTouched: result.touched } });
  } catch (err: any) {
    console.error('[api/leave] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Could not record leave' });
  }
}
