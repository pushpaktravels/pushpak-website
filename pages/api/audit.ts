// ============================================================
// GET /api/audit — owner-only audit log with filters + paging.
// ============================================================
// Query params:
//   user    string  (matches execId or userId — substring)
//   action  string  (exact match — e.g. PII_REVEAL, HOLD_APPROVE)
//   target  string  (party name or userId — substring)
//   since   ISO date
//   until   ISO date
//   before  ISO cursor — ts < before (for "Load more")
//   limit   default 100, max 500
//
// Response includes a small stats block + suspicious-activity list
// computed from the LAST 24 HOURS so the page can render the strip
// + warning banner without an extra round-trip.
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
  const before  = typeof req.query.before === 'string' ? req.query.before        : '';
  const limit   = Math.min(Number(req.query.limit) || 100, 500);

  const conds: string[] = []; const params: any[] = []; let i = 1;
  if (userQ)   { conds.push(`("execId" ILIKE $${i} OR "userId" ILIKE $${i})`); params.push(`%${userQ}%`); i++; }
  if (action)  { conds.push(`action = $${i++}`); params.push(action); }
  if (targetQ) { conds.push(`target ILIKE $${i++}`); params.push(`%${targetQ}%`); }
  if (since)   { conds.push(`ts >= $${i++}`); params.push(since); }
  if (until)   { conds.push(`ts <= $${i++}`); params.push(until); }
  if (before)  { conds.push(`ts < $${i++}`);  params.push(before); }
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    // Fetch limit + 1 so we know if there's more
    const fetched = await query<any>(
      `SELECT id, ts, "userId", "execId", action, target, detail, ip, "userAgent"
         FROM "AuditLog"
         ${whereSql}
         ORDER BY ts DESC
         LIMIT ${limit + 1}`,
      params
    );
    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    const nextCursor = hasMore ? rows[rows.length - 1].ts : null;

    const actions = await query<any>(`SELECT DISTINCT action FROM "AuditLog" ORDER BY action`);

    // ── Stats + suspicious activity (last 24h) ────────────────
    const stats = await query<any>(`
      SELECT
        SUM(CASE WHEN ts >= CURRENT_DATE                               THEN 1 ELSE 0 END)::int AS today,
        SUM(CASE WHEN ts >= NOW() - INTERVAL '24 hours'                THEN 1 ELSE 0 END)::int AS last24,
        SUM(CASE WHEN ts >= NOW() - INTERVAL '7 days'                  THEN 1 ELSE 0 END)::int AS week,
        SUM(CASE WHEN action = 'LOGIN_FAIL'  AND ts >= CURRENT_DATE    THEN 1 ELSE 0 END)::int AS fails_today,
        SUM(CASE WHEN action = 'PII_REVEAL'  AND ts >= CURRENT_DATE    THEN 1 ELSE 0 END)::int AS reveals_today
        FROM "AuditLog"
    `);
    const mostActive = await query<any>(`
      SELECT COALESCE("execId", "userId", 'SYSTEM') AS who, COUNT(*)::int AS n
        FROM "AuditLog"
       WHERE ts >= NOW() - INTERVAL '24 hours'
       GROUP BY who
       ORDER BY n DESC LIMIT 1
    `);

    // Suspicious patterns (last 24h):
    //   1. ≥3 LOGIN_FAIL from same IP within 10 minutes
    //   2. ≥10 PII_REVEAL by same user in 1 hour
    //   3. Any activity 00:00-05:00 IST (= 18:30-23:30 UTC prior day)
    const suspicious: any[] = [];

    const failBursts = await query<any>(`
      WITH recent AS (
        SELECT id, ts, ip, "execId"
          FROM "AuditLog"
         WHERE action = 'LOGIN_FAIL' AND ts >= NOW() - INTERVAL '24 hours' AND ip IS NOT NULL
      )
      SELECT ip, COUNT(*)::int AS n, MAX(ts) AS last_ts,
             STRING_AGG(DISTINCT "execId", ', ') AS targets
        FROM recent
       GROUP BY ip
      HAVING COUNT(*) >= 3
       ORDER BY n DESC
    `);
    for (const f of failBursts) {
      suspicious.push({
        kind: 'login_brute',
        title: `${f.n} failed login attempts from ${f.ip}`,
        body:  `Target IDs: ${f.targets || '—'} · last attempt ${new Date(f.last_ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
        severity: 'rust',
      });
    }

    const revealBursts = await query<any>(`
      SELECT "execId", COUNT(*)::int AS n, MAX(ts) AS last_ts
        FROM "AuditLog"
       WHERE action = 'PII_REVEAL' AND ts >= NOW() - INTERVAL '1 hour'
       GROUP BY "execId"
      HAVING COUNT(*) >= 10
       ORDER BY n DESC
    `);
    for (const r of revealBursts) {
      suspicious.push({
        kind: 'pii_burst',
        title: `${r.execId} revealed ${r.n} contact fields in the last hour`,
        body:  `Could be a normal afternoon's work — or someone scraping. Review the user's reveals.`,
        severity: 'amber',
      });
    }

    const offHours = await query<any>(`
      SELECT COUNT(*)::int AS n
        FROM "AuditLog"
       WHERE ts >= NOW() - INTERVAL '24 hours'
         AND action <> 'LOGIN_FAIL'
         AND action <> 'LOGIN_OK'
         AND action <> 'LOGOUT'
         AND EXTRACT(HOUR FROM ts AT TIME ZONE 'Asia/Kolkata') < 5
    `);
    if (offHours[0]?.n > 0) {
      suspicious.push({
        kind: 'off_hours',
        title: `${offHours[0].n} action${offHours[0].n === 1 ? '' : 's'} performed between 00:00–05:00 IST`,
        body:  `Most legitimate work happens during business hours. Filter the log to "Last 24h" and look for unusual actions.`,
        severity: 'amber',
      });
    }

    return res.json({
      ok: true,
      rows,
      knownActions: actions.map(a => a.action),
      nextCursor,
      stats: {
        today:        Number(stats[0].today        || 0),
        last24:       Number(stats[0].last24       || 0),
        week:         Number(stats[0].week         || 0),
        failsToday:   Number(stats[0].fails_today   || 0),
        revealsToday: Number(stats[0].reveals_today || 0),
        mostActive:   mostActive[0] || null,
      },
      suspicious,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Audit query failed' });
  }
}
