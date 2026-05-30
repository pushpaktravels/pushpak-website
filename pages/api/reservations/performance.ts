// ============================================================
// GET /api/reservations/performance — per-agent booking-desk metrics.
// ============================================================
// Query: ?days=7|30|90 (default 30)
//
// Cross-department performance, Reservations edition. For each agent
// (Reservation.agentExecId) it blends the three dimensions the owner
// asked for:
//   OUTPUT          — bookings, pax, fare booked, amount collected   (windowed by createdAt)
//   ACCOUNTABILITY  — Held→Ticketed conversion, collection %, and the
//                     LIVE attention flags: overdue (travelled but still
//                     owes) and at-risk (Held with travel ≤ 3 days)
//   ENGAGEMENT      — active time on the portal (ActivityDay, windowed)
//
// Gated on the 'reservations-performance' view (owner/admin by default;
// grantable to a desk lead via viewPerms). Owners/admins see every agent.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { clampDays, activeSecByExec } from '@/lib/perf';

type AgentRow = {
  execId: string;
  name: string;
  // Output (windowed by createdAt)
  bookings: number;
  pax: number;
  fareBooked: number;
  collected: number;
  ticketed: number;
  held: number;
  cancelled: number;
  // Accountability (live, current state across all non-cancelled)
  outstanding: number;
  overdue: number;
  atRisk: number;
  // Engagement (windowed)
  activeSec: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'reservations-performance')) return;

  const days = clampDays(req.query.days);

  try {
    // 1) OUTPUT — what each agent produced inside the window (by createdAt).
    const outputRows = await query<any>(
      `SELECT "agentExecId" AS exec_id,
              MAX("agentName") AS name,
              COUNT(*)::int                                            AS bookings,
              COALESCE(SUM("paxCount"), 0)::int                        AS pax,
              COALESCE(SUM("fareAmount"), 0)::numeric                  AS fare_booked,
              COALESCE(SUM("amountCollected"), 0)::numeric            AS collected,
              COUNT(*) FILTER (WHERE status = 'Ticketed')::int         AS ticketed,
              COUNT(*) FILTER (WHERE status = 'Held')::int             AS held,
              COUNT(*) FILTER (WHERE status = 'Cancelled')::int        AS cancelled
         FROM "Reservation"
        WHERE "agentExecId" IS NOT NULL
          AND "createdAt" >= NOW() - INTERVAL '${days} days'
        GROUP BY "agentExecId"`
    );

    // 2) ACCOUNTABILITY — live obligations, NOT windowed: these are the
    //    debts/risks sitting on each agent's desk right now.
    const liveRows = await query<any>(
      `SELECT "agentExecId" AS exec_id,
              MAX("agentName") AS name,
              COALESCE(SUM("fareAmount" - "amountCollected"), 0)::numeric AS outstanding,
              COUNT(*) FILTER (
                WHERE ("fareAmount" - "amountCollected") > 0
                  AND "travelDate" IS NOT NULL AND "travelDate" < NOW()
              )::int AS overdue,
              COUNT(*) FILTER (
                WHERE status = 'Held'
                  AND "travelDate" IS NOT NULL
                  AND "travelDate" >= NOW()
                  AND "travelDate" < NOW() + INTERVAL '3 days'
              )::int AS at_risk
         FROM "Reservation"
        WHERE "agentExecId" IS NOT NULL
          AND status <> 'Cancelled'
        GROUP BY "agentExecId"`
    );

    // 3) ENGAGEMENT — active portal time per agent (shared helper).
    const activeByExec = await activeSecByExec(days);

    // Merge all three by execId.
    const byExec: Record<string, AgentRow> = {};
    const bucket = (execId: string): AgentRow => (byExec[execId] ||= {
      execId, name: execId,
      bookings: 0, pax: 0, fareBooked: 0, collected: 0, ticketed: 0, held: 0, cancelled: 0,
      outstanding: 0, overdue: 0, atRisk: 0, activeSec: 0,
    });

    for (const r of outputRows) {
      const b = bucket(r.exec_id);
      if (r.name) b.name = r.name;
      b.bookings = Number(r.bookings);
      b.pax = Number(r.pax);
      b.fareBooked = Number(r.fare_booked);
      b.collected = Number(r.collected);
      b.ticketed = Number(r.ticketed);
      b.held = Number(r.held);
      b.cancelled = Number(r.cancelled);
    }
    for (const r of liveRows) {
      const b = bucket(r.exec_id);
      if (r.name) b.name = r.name;
      b.outstanding = Number(r.outstanding);
      b.overdue = Number(r.overdue);
      b.atRisk = Number(r.at_risk);
    }
    for (const [execId, sec] of Object.entries(activeByExec)) {
      // Only surface engagement for agents who also appear in the booking
      // data — otherwise every portal user would show up on the desk board.
      if (byExec[execId]) byExec[execId].activeSec = sec;
    }

    // Money realised first — the headline "performance" number here.
    const agents = Object.values(byExec).sort(
      (a, b) => b.collected - a.collected || b.fareBooked - a.fareBooked
    );

    // Firm-wide totals for the summary strip.
    const totals = agents.reduce((t, a) => ({
      bookings: t.bookings + a.bookings,
      fareBooked: t.fareBooked + a.fareBooked,
      collected: t.collected + a.collected,
      outstanding: t.outstanding + a.outstanding,
      overdue: t.overdue + a.overdue,
      atRisk: t.atRisk + a.atRisk,
    }), { bookings: 0, fareBooked: 0, collected: 0, outstanding: 0, overdue: 0, atRisk: 0 });

    return res.json({ ok: true, data: { agents, totals, days } });
  } catch (err: any) {
    console.error('[api/reservations/performance] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Performance query failed' });
  }
}
