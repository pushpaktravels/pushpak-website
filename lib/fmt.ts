// ============================================================
// Number / date / tier formatting helpers — used by every view.
// ============================================================

// Indian comma format (lakh/crore grouping). NEVER abbreviates to K/L/Cr —
// the user explicitly wants full exact numbers everywhere.
export function fmtINR(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—';
  return '₹' + Math.round(Number(n)).toLocaleString('en-IN');
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toFixed(digits) + '%';
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return 'never';
  const mins = Math.floor((Date.now() - dt.getTime()) / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return fmtDate(dt);
}

// Human-readable duration from a second count (e.g. "2h 5m", "12m", "—").
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s === 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// tierBadge moved to components/TierBadge.tsx (needs JSX, can't live in .ts)

