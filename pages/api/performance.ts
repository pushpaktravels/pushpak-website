// ============================================================
// GET /api/performance — per-exec activity metrics.
// ============================================================
// Query: ?days=7|30|90 (default 30)
//
// For each visible exec, computes:
//   calls           — count of AccountHistory rows with action='Call logged'
//   promisesAdded   — count from Promise.loggedAt in window
//   promisesKept    — count from Promise.settledOn in window, status=Kept
//   promisesBroken  — count from Promise.settledOn in window, status=Broken
//   accountsTouched — distinct count of party from AccountHistory in window
//   recovered       — sum of CollectionLog.amount in window
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const visible = visibleExecNames(user);
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);

  // Build the exec scope for use in each query
  const execScope: string[] = [];
  const execParams: string[] = [];
  let i = 1;

  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map(() => `$${i++}`).join(',');
    execScope.push(`exec IN (${placeholders})`);
    execParams.push(...arr);
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, data: { execs: [], days } });
  }

  const execWhere = execScope.length ? `AND ${execScope.join(' AND ')}` : '';

  try {
    // Calls + accounts touched + recoveries (from AccountHistory + CollectionLog)
    const callsRows = await query<any>(
      `SELECT exec,
              COUNT(*) FILTER (WHERE action = 'Call logged')::int AS calls,
              COUNT(DISTINCT party)::int AS accounts_touched
       FROM "AccountHistory"
       WHERE ts >= NOW() - INTERVAL '${days} days' AND exec IS NOT NULL ${execWhere}
       GROUP BY exec`,
      execParams
    );

    const promiseRows = await query<any>(
      `SELECT exec,
              COUNT(*) FILTER (WHERE "loggedAt"  >= NOW() - INTERVAL '${days} days')::int                                            AS added,
              COUNT(*) FILTER (WHERE status = 'Kept'   AND "settledOn" >= NOW() - INTERVAL '${days} days')::int                      AS kept,
              COUNT(*) FILTER (WHERE status = 'Broken' AND ("settledOn" >= NOW() - INTERVAL '${days} days' OR "expectedBy" >= NOW() - INTERVAL '${days} days'))::int AS broken
       FROM "Promise"
       WHERE exec IS NOT NULL ${execWhere}
       GROUP BY exec`,
      execParams
    );

    const recoveryRows = await query<any>(
      `SELECT exec, COALESCE(SUM(amount), 0)::numeric AS recovered, COUNT(*)::int AS recovery_count
       FROM "CollectionLog"
       WHERE date >= NOW() - INTERVAL '${days} days' AND exec IS NOT NULL ${execWhere}
       GROUP BY exec`,
      execParams
    );

    // Merge all three by exec
    const byExec: Record<string, any> = {};
    function bucket(name: string) {
      return byExec[name] ||= {
        exec: name, calls: 0, accountsTouched: 0,
        promisesAdded: 0, promisesKept: 0, promisesBroken: 0,
        recovered: 0, recoveryCount: 0,
      };
    }
    callsRows.forEach((r: any) => {
      const b = bucket(r.exec);
      b.calls = Number(r.calls); b.accountsTouched = Number(r.accounts_touched);
    });
    promiseRows.forEach((r: any) => {
      const b = bucket(r.exec);
      b.promisesAdded = Number(r.added); b.promisesKept = Number(r.kept); b.promisesBroken = Number(r.broken);
    });
    recoveryRows.forEach((r: any) => {
      const b = bucket(r.exec);
      b.recovered = Number(r.recovered); b.recoveryCount = Number(r.recovery_count);
    });

    const execs = Object.values(byExec).sort((a: any, b: any) => b.recovered - a.recovered);

    return res.json({ ok: true, data: { execs, days } });
  } catch (err: any) {
    console.error('[api/performance] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Performance query failed' });
  }
}
