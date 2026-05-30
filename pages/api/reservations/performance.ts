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
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { clampDays, activeSecByExec, reservationAgentMetrics, type ReservationAgent } from '@/lib/perf';

// The desk board is the shared per-agent metrics (OUTPUT + ACCOUNTABILITY,
// from lib/perf so the Command Center roll-up can never disagree) plus the
// ENGAGEMENT dimension (active portal time) layered on here.
type AgentRow = ReservationAgent & { activeSec: number };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'reservations-performance')) return;

  const days = clampDays(req.query.days);

  try {
    // OUTPUT + ACCOUNTABILITY come from the shared helper (single source of
    // truth with the Command Center roll-up); ENGAGEMENT is layered on here.
    const [metricsByExec, activeByExec] = await Promise.all([
      reservationAgentMetrics(days),
      activeSecByExec(days),
    ]);

    const byExec: Record<string, AgentRow> = {};
    for (const [execId, m] of Object.entries(metricsByExec)) {
      byExec[execId] = { ...m, activeSec: 0 };
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
