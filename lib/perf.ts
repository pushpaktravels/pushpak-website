// ============================================================
// lib/perf.ts — shared performance-instrumentation helpers.
// ============================================================
// Cross-department performance pages all need the same two things:
//   1. a sanitised time window (days), and
//   2. "active time on the portal" per person, from ActivityDay.
// Keeping these here means every department's performance endpoint
// (accounts, reservations, and the future Command Center roll-up)
// measures ENGAGEMENT the same way instead of re-querying ad hoc.
// ============================================================
import { query } from './pg';

// Clamp a ?days query param to a sane window (1..365), default 30.
export function clampDays(raw: unknown, def = 30): number {
  return Math.min(Math.max(Number(raw) || def, 1), 365);
}

// Active seconds per execId over the last `days` days. ActivityDay holds
// one row per (user, IST date) with cumulative activeSec; we roll it up by
// the denormalised execId so callers can join it onto any per-agent table.
// `days` is a clamped number (see clampDays) so interpolation is safe.
export async function activeSecByExec(days: number): Promise<Record<string, number>> {
  const rows = await query<any>(
    `SELECT "execId" AS exec_id, COALESCE(SUM("activeSec"), 0)::int AS active_sec
       FROM "ActivityDay"
      WHERE "execId" IS NOT NULL
        AND date >= (NOW() - INTERVAL '${days} days')::date
      GROUP BY "execId"`
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.exec_id] = Number(r.active_sec);
  return out;
}

// ── Reservations desk metrics ─────────────────────────────────
// Per-agent booking-desk numbers, shared by the dedicated Desk
// Performance page (/api/reservations/performance) AND the owner's
// Command Center roll-up (/api/overview) so the two can never tell a
// different story. Two dimensions:
//   OUTPUT          — bookings, pax, fare booked, collected, plus the
//                     status mix (ticketed/held/cancelled), WINDOWED by
//                     createdAt over the last `days` days.
//   ACCOUNTABILITY  — outstanding, overdue (travelled but still owes) and
//                     at-risk (Held with travel ≤ 3 days). These are LIVE
//                     (current state, NOT windowed) — the debts/risks on
//                     the desk right now. ENGAGEMENT (active time) is left
//                     to callers via activeSecByExec so this stays one
//                     focused DB round-trip.
// `days` is a clamped number (see clampDays) so interpolation is safe.
export type ReservationAgent = {
  execId: string;
  name: string;
  bookings: number;
  pax: number;
  fareBooked: number;
  collected: number;
  ticketed: number;
  held: number;
  cancelled: number;
  outstanding: number;
  overdue: number;
  atRisk: number;
};

export async function reservationAgentMetrics(
  days: number,
): Promise<Record<string, ReservationAgent>> {
  const [outputRows, liveRows] = await Promise.all([
    // OUTPUT — what each agent produced inside the window (by createdAt).
    query<any>(
      `SELECT "agentExecId" AS exec_id,
              MAX("agentName") AS name,
              COUNT(*)::int                                      AS bookings,
              COALESCE(SUM("paxCount"), 0)::int                  AS pax,
              COALESCE(SUM("fareAmount"), 0)::numeric            AS fare_booked,
              COALESCE(SUM("amountCollected"), 0)::numeric       AS collected,
              COUNT(*) FILTER (WHERE status = 'Ticketed')::int   AS ticketed,
              COUNT(*) FILTER (WHERE status = 'Held')::int       AS held,
              COUNT(*) FILTER (WHERE status = 'Cancelled')::int  AS cancelled
         FROM "Reservation"
        WHERE "agentExecId" IS NOT NULL
          AND "createdAt" >= NOW() - INTERVAL '${days} days'
        GROUP BY "agentExecId"`,
    ),
    // ACCOUNTABILITY — live obligations, NOT windowed.
    query<any>(
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
        GROUP BY "agentExecId"`,
    ),
  ]);

  const byExec: Record<string, ReservationAgent> = {};
  const bucket = (execId: string): ReservationAgent => (byExec[execId] ||= {
    execId, name: execId,
    bookings: 0, pax: 0, fareBooked: 0, collected: 0, ticketed: 0, held: 0, cancelled: 0,
    outstanding: 0, overdue: 0, atRisk: 0,
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
  return byExec;
}
