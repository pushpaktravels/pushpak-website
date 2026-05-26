// ============================================================
// /portal — Dashboard view.
// Hero KPI + secondary KPI row + tier distribution + last refresh card.
// Ported from the legacy Page-v2.html dashboard section.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { fmtINR, fmtRelative } from '../lib/fmt';

type DashboardData = {
  total: number;
  accounts: number;
  d30: number; d60: number; d90: number; d90p: number;
  counts: Record<string, number>;
  onHoldActive: number;
  onHoldCandidate: number;
  lastRefreshAt: string | null;
  lastRefreshBy: string | null;
  lastRefreshDelta: number | null;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load dashboard');
        setData(r.data);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell title="Dashboard" crumb="Overview">
      {loading && <div style={{ padding: 40, color: 'var(--t-3)' }}>Loading dashboard…</div>}
      {error && <div style={{ padding: 40, color: 'var(--rust)' }}>Failed: {error}</div>}

      {data && (
        <>
          {/* ── HERO ROW: 4 KPI cards ── */}
          <div className="dash-row four">
            <div className="kpi hero">
              <div className="kpi-label">Total Outstanding</div>
              <div className="kpi-num lg">{fmtINR(data.total)}</div>
              <div className="kpi-meta">{data.accounts.toLocaleString('en-IN')} accounts</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">On Hold · Active</div>
              <div className="kpi-num" style={{ color: 'var(--rust)' }}>{data.onHoldActive}</div>
              <div className="kpi-meta">blocking new bookings</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Hold Candidates</div>
              <div className="kpi-num" style={{ color: 'var(--amber)' }}>{data.onHoldCandidate}</div>
              <div className="kpi-meta">awaiting approval</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Last Refresh</div>
              <div className="kpi-num md">{fmtRelative(data.lastRefreshAt)}</div>
              <div className="kpi-meta">
                {data.lastRefreshBy ? `by ${data.lastRefreshBy}` : 'No refresh yet'}
                {data.lastRefreshDelta != null && (
                  <span style={{ marginLeft: 8, color: data.lastRefreshDelta < 0 ? 'var(--sage)' : 'var(--rust)' }}>
                    {data.lastRefreshDelta < 0 ? '↓' : '↑'} {fmtINR(Math.abs(data.lastRefreshDelta))}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── AGING + TIER DISTRIBUTION ── */}
          <div className="dash-row two" style={{ marginTop: 18 }}>
            <div className="kpi">
              <div className="kpi-label">Aging Buckets</div>
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                {[
                  { label: '≤ 30 d', value: data.d30 },
                  { label: '≤ 60 d', value: data.d60 },
                  { label: '≤ 90 d', value: data.d90 },
                  { label: '> 90 d', value: data.d90p },
                ].map(b => (
                  <div key={b.label} style={{ padding: '12px 0' }}>
                    <div style={{ fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{b.label}</div>
                    <div style={{ fontFamily: "inherit", fontSize: 14, color: 'var(--navy-deep)', fontWeight: 600 }}>{fmtINR(b.value)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="kpi">
              <div className="kpi-label">Tier Distribution</div>
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
                {(['A','B','C','D','E'] as const).map(t => (
                  <div key={t} style={{ textAlign: 'center' }}>
                    <div className={`tier tier-${t}`} style={{ display: 'inline-block', padding: '5px 12px', fontSize: 14, fontWeight: 700 }}>{t}</div>
                    <div style={{ marginTop: 8, fontSize: 18, fontWeight: 600, color: 'var(--navy-deep)' }}>{data.counts[t] || 0}</div>
                    <div style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 600, marginTop: 2 }}>
                      {{ A: 'Recents', B: 'Due', C: 'Overdue', D: 'Doubtful', E: 'Legal' }[t]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── EMPTY STATE NOTE while migration pending ── */}
          {data.accounts === 0 && (
            <div className="view-empty" style={{ marginTop: 24 }}>
              <h3>No accounts loaded yet</h3>
              <p>
                The database is wired up and ready. Once you upload your first FinBook export
                via <strong>Upload &amp; Refresh</strong>, accounts, aging buckets, and tier counts
                will populate here automatically.
              </p>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
