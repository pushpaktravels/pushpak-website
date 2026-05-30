// ============================================================
// /api/attendance/login-matches — link portal logins ↔ employees.
// ============================================================
// GET   → propose login↔employee links by name (employees not yet
//         linked, vs active portal logins not yet taken). The owner
//         reviews; we never auto-commit.
// POST  { confirmations: [{ employeeId, execId }] } → store the link
//         as Employee."loginExecId". All-or-nothing per request.
//
// The link lives entirely on the Employee side — the User (login) table
// is only READ here, never written — so existing logins are untouched.
// Auth: owner / admin / hr (the HR module).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, withTransaction } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { normalizeName, nameMatchScore } from '@/lib/attendance-match';

// Strip a trailing login suffix ("RAHUL01" → "RAHUL") so the execId can
// back up a weak display-name match.
function execIdToName(execId: string): string {
  return execId.replace(/\d+$/, '');
}

const Body = z.object({
  confirmations: z.array(z.object({
    employeeId: z.string().min(1),
    execId: z.string().min(1),
  })).min(1),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    if (!requireView(user, res, 'employees')) return;

    const employees = await query<any>(
      `SELECT id, name, "hrCode", "loginExecId" FROM "Employee" WHERE active = TRUE`,
    );
    const users = await query<any>(
      `SELECT "execId", name, role FROM "User" WHERE active = TRUE`,
    );

    const takenExecIds = new Set(
      employees.map((e: any) => e.loginExecId).filter(Boolean),
    );

    const proposals: Array<{
      employeeId: string; employeeName: string; hrCode: string;
      execId: string; userName: string; role: string;
      score: number; confidence: 'high' | 'medium' | 'low';
    }> = [];

    for (const e of employees) {
      if (e.loginExecId) continue; // already linked
      const empNorm = normalizeName(e.name);
      let best: any = null;
      let bestScore = 0;
      for (const u of users) {
        if (takenExecIds.has(u.execId)) continue;
        const byName = nameMatchScore(empNorm, normalizeName(u.name));
        const byExec = nameMatchScore(empNorm, normalizeName(execIdToName(u.execId)));
        const score = Math.max(byName, byExec);
        if (score > bestScore) { bestScore = score; best = u; }
      }
      if (best && bestScore >= 0.6) {
        proposals.push({
          employeeId: e.id, employeeName: e.name, hrCode: e.hrCode,
          execId: best.execId, userName: best.name, role: best.role,
          score: Number(bestScore.toFixed(2)),
          confidence: bestScore >= 0.95 ? 'high' : bestScore >= 0.75 ? 'medium' : 'low',
        });
      }
    }

    return res.json({ ok: true, proposals });
  }

  if (req.method === 'POST') {
    if (!requireViewEdit(user, res, 'employees')) return;
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const { confirmations } = parsed.data;

    try {
      const linked = await withTransaction(async (q) => {
        let count = 0;
        for (const { employeeId, execId } of confirmations) {
          const emp = (await q(`SELECT id FROM "Employee" WHERE id = $1`, [employeeId]))[0];
          if (!emp) throw new Error('Employee not found');
          // The login must exist (we only READ User) and not already be
          // claimed by another employee.
          const login = (await q(`SELECT "execId" FROM "User" WHERE "execId" = $1`, [execId]))[0];
          if (!login) throw new Error(`Login ${execId} not found`);
          const clash = (await q(`SELECT id FROM "Employee" WHERE "loginExecId" = $1 AND id <> $2`, [execId, employeeId]))[0];
          if (clash) throw new Error(`Login ${execId} is already linked to another employee`);

          await q(`UPDATE "Employee" SET "loginExecId" = $1, "updatedAt" = NOW() WHERE id = $2`, [execId, employeeId]);
          count++;
        }
        return count;
      });

      audit(req, user, 'EMPLOYEE_LOGIN_LINK', null, { linked, confirmations });
      return res.json({ ok: true, linked });
    } catch (err: any) {
      console.error('[api/attendance/login-matches] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Link failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
