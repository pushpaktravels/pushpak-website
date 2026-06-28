// ============================================================
// GET /api/me/dashboard — personal stats for the logged-in user.
// ============================================================
// Combines REAL data (ActivityDay, AccountHistory, PointEvent) with
// HR fields that are placeholders until the HR system is integrated.
// HR fields are returned with `placeholder: true` so the UI can show
// them with a "pending HR system" treatment instead of fake-looking
// numbers.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { financialYearOf } from '@/lib/attendance-db';

// Normalise a pg DATE (Date or string) to "YYYY-MM-DD".
function isoDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  return String(v).slice(0, 10);
}

function todayIST(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 5);
  d.setUTCMinutes(d.getUTCMinutes() + 30);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const today = todayIST();
  const monthStart = today.slice(0, 8) + '01';

  // ── Activity (real, from ActivityDay) ──
  const activity = await queryOne<any>(
    `SELECT
        COALESCE(SUM(CASE WHEN date = $2::date THEN "activeSec" ELSE 0 END), 0)::int AS today_sec,
        COALESCE(SUM(CASE WHEN date >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '6 days' THEN "activeSec" ELSE 0 END), 0)::int AS week_sec,
        COALESCE(SUM(CASE WHEN date >= $3::date THEN "activeSec" ELSE 0 END), 0)::int AS month_sec,
        COUNT(*) FILTER (WHERE date >= $3::date AND "activeSec" >= 1800)::int AS month_active_days,
        MAX("lastPingAt") AS last_ping_at
       FROM "ActivityDay"
      WHERE "userId" = $1`,
    [user.id, today, monthStart]
  );

  // ── Recent activity per-day for the chart (last 14 days) ──
  const daily = await query<any>(
    `SELECT date::text AS date, "activeSec"::int AS sec
       FROM "ActivityDay"
      WHERE "userId" = $1
        AND date >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '13 days'
      ORDER BY date ASC`,
    [user.id]
  );

  // ── Performance: points + actions from existing scoreboard data ──
  const points = await queryOne<any>(
    `SELECT
        COALESCE(SUM(CASE WHEN ts >= $2::timestamp THEN points ELSE 0 END), 0)::int AS month_points,
        COALESCE(SUM(points), 0)::int AS total_points,
        COUNT(*) FILTER (WHERE ts >= $2::timestamp)::int AS month_events
       FROM "PointEvent"
      WHERE UPPER(exec) = UPPER($1)`,
    [user.name, monthStart]
  );

  // ── User actions (calls / promises / etc.) from AccountHistory ──
  const actions = await queryOne<any>(
    `SELECT COUNT(*)::int AS month_count
       FROM "AccountHistory"
      WHERE UPPER(exec) = UPPER($1)
        AND ts >= $2::timestamp
        AND source = 'Portal'`,
    [user.name, monthStart]
  );

  // ── Consistency: % of business days this month with ≥30min activity ──
  // Business days = weekdays so far this month (Mon-Sat for India; Sun off)
  const now = new Date();
  const day = now.getDate();
  let businessDays = 0;
  for (let i = 1; i <= day; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), i);
    if (d.getDay() !== 0) businessDays++; // Sun = 0
  }
  const consistencyPct = businessDays > 0
    ? Math.round((Number(activity?.month_active_days || 0) / businessDays) * 100)
    : 0;

  // ── Employee-linked HR data (real, when the login is tied to an Employee) ──
  // dob for the identity card; leave balance from the SAME LeaveBalance row the
  // My Leave page and the HR leave desk read, so the number is identical
  // everywhere in the portal.
  const emp = await queryOne<any>(
    `SELECT id, dob FROM "Employee" WHERE "loginExecId" = $1 AND active = TRUE`,
    [user.execId],
  );
  const leaveBal = emp
    ? await queryOne<any>(
        `SELECT opening, used, remaining FROM "LeaveBalance"
          WHERE "employeeId" = $1 AND "financialYear" = $2`,
        [emp.id, financialYearOf(new Date())],
      )
    : null;
  // No FY row yet = nothing drawn this year: full 18 still available.
  const leavesTotal = leaveBal ? Number(leaveBal.opening) : 18;
  const leavesUsed = emp ? (leaveBal ? Number(leaveBal.used) : 0) : null;
  const leavesRemaining = emp ? (leaveBal ? Number(leaveBal.remaining) : leavesTotal) : null;

  return res.json({
    ok: true,
    profile: {
      name:   user.name,
      execId: user.execId,
      role:   user.role,
      email:  (user as any).email || null,
      dob:    isoDate(emp?.dob),
      lastLoginAt: user.lastLoginAt,
    },
    activity: {
      todaySec:        Number(activity?.today_sec || 0),
      weekSec:         Number(activity?.week_sec || 0),
      monthSec:        Number(activity?.month_sec || 0),
      lastPingAt:      activity?.last_ping_at || null,
      monthActiveDays: Number(activity?.month_active_days || 0),
      businessDays,
      consistencyPct,
      daily: daily.map(d => ({ date: d.date, sec: Number(d.sec) })),
    },
    performance: {
      monthPoints: Number(points?.month_points || 0),
      totalPoints: Number(points?.total_points || 0),
      monthEvents: Number(points?.month_events || 0),
      monthActions: Number(actions?.month_count || 0),
    },
    // HR fields. Leave balance is LIVE (LeaveBalance table); advances /
    // installments remain pending until that side of HR is wired.
    hr: {
      linked: !!emp,
      leavesTotal,
      leavesUsed,
      leavesRemaining,
      advanceBalance: null,
      activeInstalments: null,
    },
  });
}
