// ============================================================
// GET /api/audit — owner-only audit log with filters.
// ============================================================
// Query params:
//   user    string  (matches execId or userId — substring)
//   action  string  (exact match — e.g. PII_REVEAL, HOLD_APPROVE)
//   target  string  (party name or userId — substring)
//   since   ISO date
//   until   ISO date
//   limit   default 200, max 1000
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner')) return;

  const userQ   = typeof req.query.user   === 'string' ? req.query.user.trim()   : '';
  const action  = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const targetQ = typeof req.query.target === 'string' ? req.query.target.trim() : '';
  const since   = typeof req.query.since  === 'string' ? req.query.since         : '';
  const until   = typeof req.query.until  === 'string' ? req.query.until         : '';
  const limit   = Math.min(Number(req.query.limit) || 200, 1000);

  const conds: string[] = []; const params: any[] = []; let i = 1;
  if (userQ)   { conds.push(`("execId" ILIKE $${i} OR "userId" ILIKE $${i})`); params.push(`%${userQ}%`); i++; }
  if (action)  { conds.push(`action = $${i++}`); params.push(action); }
  if (targetQ) { conds.push(`target ILIKE $${i++}`); params.push(`%${targetQ}%`); }
  if (since)   { conds.push(`ts >= $${i++}`); params.push(since); }
  if (until)   { conds.push(`ts <= $${i++}`); params.push(until); }
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const rows = await query<any>(
      `SELECT id, ts, "userId", "execId", action, target, detail, ip, "userAgent"
         FROM "AuditLog"
         ${whereSql}
         ORDER BY ts DESC
         LIMIT ${limit}`,
      params
    );
    const actions = await query<any>(`SELECT DISTINCT action FROM "AuditLog" ORDER BY action`);
    return res.json({ ok: true, rows, knownActions: actions.map(a => a.action) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Audit query failed' });
  }
}
