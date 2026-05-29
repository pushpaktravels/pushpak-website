// ============================================================
// GET /api/users/login-history?execId=XXX — owner-only.
// ============================================================
// Recent authentication events for one user, read straight from
// the AuditLog (LOGIN_OK / LOGIN_FAIL and the security actions taken
// against the account). Lets the owner answer "when did Raunak last
// sign in, and from where — and were there failed attempts?".
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';

const AUTH_ACTIONS = [
  'LOGIN_OK', 'LOGIN_FAIL',
  'PASSWORD_CHANGE_SELF', 'PASSWORD_CHANGE_FAIL', 'PASSWORD_RESET',
  'ACCOUNT_UNLOCK', 'MFA_RESET', 'MFA_REQUIRED_ON', 'MFA_REQUIRED_OFF',
  'FORCE_PASSWORD_CHANGE',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner')) return;

  const execId = String(req.query.execId || '').toUpperCase().trim();
  if (!execId) return res.status(400).json({ ok: false, error: 'execId required' });

  try {
    // Match either the actor (own logins) or the target (security
    // actions the owner took against this account).
    const rows = await query<any>(
      `SELECT ts, action, detail, ip, "userAgent"
         FROM "AuditLog"
        WHERE action = ANY($1)
          AND ("execId" = $2 OR target = $2)
        ORDER BY ts DESC
        LIMIT 50`,
      [AUTH_ACTIONS, execId]
    );
    return res.json({
      ok: true,
      data: {
        events: rows.map((r: any) => ({
          ts: r.ts,
          action: r.action,
          ip: r.ip || null,
          detail: r.detail || null,
          userAgent: r.userAgent || null,
        })),
      },
    });
  } catch (err: any) {
    console.error('[api/users/login-history] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'History query failed' });
  }
}
