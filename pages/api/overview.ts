// ============================================================
// GET /api/overview — the owner's Command Center: company-wide
// financials + workforce + attendance + team performance in one
// payload. Owners only (gated on the 'overview' view).
// ============================================================
// Honest about data coverage: real PERFORMANCE numbers exist only
// for the Accounts/Followup team (CollectionLog / AccountHistory /
// Promise / PointEvent). Every employee has ATTENDANCE data. Other
// departments (visa / packages / reservations) currently surface
// headcount + attendance only — their performance instrumentation
// lands in a later phase.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

const n = (v: any) => Number(v ?? 0);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'overview')) return;

  try {
    const [
      companyRows, recoveryRows, legalRows, promiseRows, trendRows,
      workforceRows, attTotalRows, attLatestDateRows, attByDeptRows, attConcernRows,
      recoveredByExec, callsByExec, openHoldsValueRows,
    ] = await Promise.all([
      // ── Company financials (whole book) ──
      query<any>(`
        SELECT
          COALESCE(SUM(bill),0)::float8                                         AS total_outstanding,
          COUNT(*)::int                                                         AS accounts,
          COALESCE(SUM(d30),0)::float8                                          AS d30,
          COALESCE(SUM(d60),0)::float8                                          AS d60,
          COALESCE(SUM(d90),0)::float8                                          AS d90,
          COALESCE(SUM(d90p),0)::float8                                         AS d90p,
          SUM(CASE WHEN "onHold"='Active'    THEN 1 ELSE 0 END)::int            AS holds_active,
          SUM(CASE WHEN "onHold"='Candidate' THEN 1 ELSE 0 END)::int            AS holds_candidate,
          SUM(CASE WHEN tier IN ('D','E') THEN 1 ELSE 0 END)::int               AS critical_count,
          COALESCE(SUM(CASE WHEN tier IN ('D','E') THEN bill ELSE 0 END),0)::float8 AS critical_value,
          SUM(CASE WHEN "lastTouched" IS NULL OR "lastTouched" < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS stale_count
        FROM "Account"
      `, []),
      // ── Recovered: last 30d vs the 30d before that ──
      query<any>(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE date >= CURRENT_DATE - 30),0)::float8                              AS recovered_30,
          COALESCE(SUM(amount) FILTER (WHERE date >= CURRENT_DATE - 60 AND date < CURRENT_DATE - 30),0)::float8 AS recovered_prev30
        FROM "CollectionLog"
      `, []),
      // ── Legal exposure (open cases) ──
      query<any>(`
        SELECT COUNT(*)::int AS open_cases, COALESCE(SUM(outstanding),0)::float8 AS exposure
        FROM "LegalCase"
        WHERE status IN ('NoticeSent','Filed','InCourt')
      `, []),
      // ── Promise kept-rate (settled in last 90d) ──
      query<any>(`
        SELECT
          COUNT(*) FILTER (WHERE status='Kept'   AND "settledOn" >= NOW() - INTERVAL '90 days')::int AS kept,
          COUNT(*) FILTER (WHERE status='Broken' AND "settledOn" >= NOW() - INTERVAL '90 days')::int AS broken,
          COUNT(*) FILTER (WHERE status='Open')::int                                                 AS open
        FROM "Promise"
      `, []),
      // ── Weekly collections trend (last 12 weeks) ──
      query<any>(`
        SELECT to_char(date_trunc('week', date), 'YYYY-MM-DD') AS week,
               COALESCE(SUM(amount),0)::float8 AS total
        FROM "CollectionLog"
        WHERE date >= CURRENT_DATE - 84
        GROUP BY 1 ORDER BY 1
      `, []),
      // ── Workforce: active login accounts grouped by role ──
      query<any>(`
        SELECT role, COUNT(*)::int AS count
        FROM "User"
        WHERE active = true
        GROUP BY role
      `, []),
      // ── Attendance snapshot for the latest available date ──
      query<any>(`
        SELECT status, COUNT(*)::int AS count
        FROM "DailyAttendance"
        WHERE date = (SELECT MAX(date) FROM "DailyAttendance")
        GROUP BY status
      `, []),
      query<any>(`SELECT to_char(MAX(date), 'YYYY-MM-DD') AS d FROM "DailyAttendance"`, []),
      // ── Attendance by department, month-to-date ──
      query<any>(`
        SELECT COALESCE(NULLIF(TRIM(e.department), ''), '(Unassigned)') AS department,
               COUNT(DISTINCT e.id)::int AS headcount,
               COUNT(*) FILTER (WHERE da.status IN ('PRESENT','LATE','HALF_DAY','ON_DUTY'))::int AS present_days,
               COUNT(*) FILTER (WHERE da.status = 'LATE')::int    AS late_days,
               COUNT(*) FILTER (WHERE da.status = 'ABSENT')::int  AS absent_days,
               COUNT(*) FILTER (WHERE da.status = 'LEAVE')::int   AS leave_days,
               COUNT(da.id)::int AS marked_days
        FROM "Employee" e
        LEFT JOIN "DailyAttendance" da
               ON da."employeeId" = e.id AND da.date >= date_trunc('month', CURRENT_DATE)
        WHERE e.active = true
        GROUP BY 1
        ORDER BY headcount DESC, department ASC
      `, []),
      // ── Attendance concerns (month-to-date) ──
      query<any>(`
        SELECT e.name,
               COALESCE(NULLIF(TRIM(e.department), ''), '(Unassigned)') AS department,
               COUNT(*) FILTER (WHERE da.status = 'ABSENT')::int AS absents,
               COUNT(*) FILTER (WHERE da.status = 'LATE')::int   AS lates
        FROM "Employee" e
        JOIN "DailyAttendance" da
          ON da."employeeId" = e.id AND da.date >= date_trunc('month', CURRENT_DATE)
        WHERE e.active = true
        GROUP BY e.name, e.department
        HAVING COUNT(*) FILTER (WHERE da.status='ABSENT') > 0
            OR COUNT(*) FILTER (WHERE da.status='LATE') >= 3
        ORDER BY absents DESC, lates DESC
        LIMIT 12
      `, []),
      // ── Accounts team: recovered + recovery count per exec (last 30d) ──
      query<any>(`
        SELECT exec, COALESCE(SUM(amount),0)::float8 AS recovered, COUNT(*)::int AS recovery_count
        FROM "CollectionLog"
        WHERE date >= CURRENT_DATE - 30 AND exec IS NOT NULL
        GROUP BY exec
      `, []),
      // ── Accounts team: calls per exec (last 30d) ──
      query<any>(`
        SELECT exec, COUNT(*) FILTER (WHERE action='Call logged')::int AS calls
        FROM "AccountHistory"
        WHERE ts >= NOW() - INTERVAL '30 days' AND exec IS NOT NULL
        GROUP BY exec
      `, []),
      // ── Value locked under active/candidate holds ──
      query<any>(`
        SELECT
          COALESCE(SUM(bill) FILTER (WHERE "onHold"='Active'),0)::float8    AS active_value,
          COALESCE(SUM(bill) FILTER (WHERE "onHold"='Candidate'),0)::float8 AS candidate_value
        FROM "Account"
      `, []),
    ]);

    const c = companyRows[0] || {};
    const rec = recoveryRows[0] || {};
    const legal = legalRows[0] || {};
    const pr = promiseRows[0] || {};
    const holdsVal = openHoldsValueRows[0] || {};

    const keptDen = n(pr.kept) + n(pr.broken);
    const keptRate = keptDen > 0 ? Math.round((n(pr.kept) / keptDen) * 100) : null;

    // Merge accounts-team leaderboard by exec.
    const byExec: Record<string, { exec: string; recovered: number; recoveryCount: number; calls: number }> = {};
    const bucket = (name: string) => (byExec[name] ||= { exec: name, recovered: 0, recoveryCount: 0, calls: 0 });
    recoveredByExec.forEach((r: any) => { const b = bucket(r.exec); b.recovered = n(r.recovered); b.recoveryCount = n(r.recovery_count); });
    callsByExec.forEach((r: any) => { bucket(r.exec).calls = n(r.calls); });
    const leaderboard = Object.values(byExec)
      .sort((a, b) => b.recovered - a.recovered || b.calls - a.calls)
      .slice(0, 12);

    // Attendance today snapshot keyed by status.
    const attToday: Record<string, number> = {};
    attTotalRows.forEach((r: any) => { attToday[r.status] = n(r.count); });

    return res.json({
      ok: true,
      data: {
        company: {
          totalOutstanding: n(c.total_outstanding),
          accounts: n(c.accounts),
          aging: { d30: n(c.d30), d60: n(c.d60), d90: n(c.d90), d90p: n(c.d90p) },
          holdsActive: n(c.holds_active),
          holdsCandidate: n(c.holds_candidate),
          holdsActiveValue: n(holdsVal.active_value),
          holdsCandidateValue: n(holdsVal.candidate_value),
          criticalCount: n(c.critical_count),
          criticalValue: n(c.critical_value),
          staleCount: n(c.stale_count),
          recovered30: n(rec.recovered_30),
          recoveredPrev30: n(rec.recovered_prev30),
          legalOpenCases: n(legal.open_cases),
          legalExposure: n(legal.exposure),
          promiseKept: n(pr.kept),
          promiseBroken: n(pr.broken),
          promiseOpen: n(pr.open),
          keptRate,
        },
        trend: trendRows.map((r: any) => ({ week: r.week, total: n(r.total) })),
        workforce: workforceRows.map((r: any) => ({ role: r.role, count: n(r.count) })),
        attendance: {
          asOf: attLatestDateRows[0]?.d || null,
          today: {
            present: (attToday['PRESENT'] || 0) + (attToday['ON_DUTY'] || 0),
            late: attToday['LATE'] || 0,
            halfDay: attToday['HALF_DAY'] || 0,
            absent: attToday['ABSENT'] || 0,
            leave: attToday['LEAVE'] || 0,
            offDay: (attToday['OFF_DAY'] || 0) + (attToday['HOLIDAY'] || 0),
          },
          byDept: attByDeptRows.map((r: any) => ({
            department: r.department,
            headcount: n(r.headcount),
            presentDays: n(r.present_days),
            lateDays: n(r.late_days),
            absentDays: n(r.absent_days),
            leaveDays: n(r.leave_days),
            markedDays: n(r.marked_days),
          })),
          concerns: attConcernRows.map((r: any) => ({
            name: r.name, department: r.department, absents: n(r.absents), lates: n(r.lates),
          })),
        },
        leaderboard,
      },
    });
  } catch (err: any) {
    console.error('[api/overview] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Overview query failed' });
  }
}
