// ============================================================
// Audit log — every privileged mutation MUST call audit().
// "Who changed Reeta's credit limit last Tuesday?" answered here.
// ============================================================
// Uses node-postgres directly (lib/pg) — Prisma typed queries don't
// play well with Supabase pgbouncer. Audit writes are best-effort:
// if they fail, the calling mutation still succeeds (we never want
// audit infrastructure to break a real business action).
// ============================================================
import { query } from './pg';
import type { NextApiRequest } from 'next';
import { getIp } from './auth';
import type { User } from '@prisma/client';

export async function audit(
  req: NextApiRequest,
  user: Pick<User, 'id' | 'execId'> | null,
  action: string,
  target: string | null,
  detail?: Record<string, unknown> | string
) {
  try {
    const detailStr =
      detail == null
        ? null
        : typeof detail === 'string'
          ? detail
          : JSON.stringify(detail);

    // AuditLog.id is cuid in Prisma but we generate one inline for pg.
    const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    await query(
      `INSERT INTO "AuditLog"
        (id, ts, "userId", "execId", action, target, detail, ip, "userAgent")
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        user?.id ?? null,
        user?.execId ?? null,
        action,
        target,
        detailStr,
        getIp(req),
        (req.headers['user-agent'] || '').slice(0, 500),
      ]
    );
  } catch (e) {
    // Don't let an audit failure break the mutation itself; just log it.
    console.error('audit write failed', e);
  }
}
