// ============================================================
// POST /api/attendance/match-codes — confirm machine-code mappings.
// ============================================================
// Body: { confirmations: [{ stubId, masterId }] }
// For each confirmation: move the stub's machineCode onto the chosen
// master employee, repoint that stub's DailyAttendance rows to the
// master, then delete the now-empty stub. All-or-nothing per request.
//
// This is the "user reviews, store permanent machineCode" step.
// Auth: owner / admin only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { withTransaction } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const Body = z.object({
  confirmations: z.array(z.object({
    stubId: z.string().min(1),
    masterId: z.string().min(1),
  })).min(1),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireViewEdit(user, res, 'employees')) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { confirmations } = parsed.data;

  try {
    const linked = await withTransaction(async (q) => {
      let count = 0;
      for (const { stubId, masterId } of confirmations) {
        const stub = (await q(`SELECT id, "machineCode", "shiftIn", "shiftOut", department FROM "Employee" WHERE id = $1`, [stubId]))[0];
        const master = (await q(`SELECT id, "machineCode" FROM "Employee" WHERE id = $1`, [masterId]))[0];
        if (!stub || !master) throw new Error('Stub or master employee not found');
        if (!stub.machineCode) throw new Error('Stub has no machine code to transfer');
        if (master.machineCode) throw new Error('Target employee already has a machine code');

        // Move machineCode + biometric-derived shift/department onto master.
        await q(
          `UPDATE "Employee" SET
             "machineCode" = $1,
             "shiftIn" = COALESCE("shiftIn", $2),
             "shiftOut" = COALESCE("shiftOut", $3),
             department = COALESCE(department, $4),
             "updatedAt" = NOW()
           WHERE id = $5`,
          [stub.machineCode, stub.shiftIn, stub.shiftOut, stub.department, masterId],
        );
        // Repoint attendance history from stub → master.
        await q(`UPDATE "DailyAttendance" SET "employeeId" = $1, "updatedAt" = NOW() WHERE "employeeId" = $2`, [masterId, stubId]);
        // Drop the stub (CASCADE clears any leftover child rows).
        await q(`DELETE FROM "Employee" WHERE id = $1`, [stubId]);
        count++;
      }
      return count;
    });

    audit(req, user, 'EMPLOYEE_CODE_MATCH', null, { linked, confirmations });
    return res.json({ ok: true, linked });
  } catch (err: any) {
    console.error('[api/attendance/match-codes] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Match failed' });
  }
}
