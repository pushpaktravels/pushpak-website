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

// Human-friendly duration: 7320 → "2h 2m", 540 → "9m", 0 → "—".
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s === 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
