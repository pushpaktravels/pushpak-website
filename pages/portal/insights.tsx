// ============================================================
// /portal/insights — owner/analyst macro view.
// ============================================================
// Cards: summary KPIs + collections trend (mini sparkline) +
// top accounts table + family concentration table.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR } from '../../lib/fmt';

type Insights = {
  summary: {
    total_accounts: number;
    total_outstanding: string | number;
    active_holds: number;
    critical_count: number;
    stale_count: number;
  };
  collectionsTrend: { day: string; total: string | number }[];
  topAccounts: {
    id: string; party: string; family: string | null;
    exec: string | null; tier: string;
    bill: string | number; onHold: string | null;
  }[];
  families: { family: string; account_count: number; total: string | number }[];
};

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/insights')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setData(r.data);
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) return <AppShell title="Insights" crumb="Insights"><div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div></AppShell>;
  if (!data) return <AppShell title="Insights" crumb="Insights"><div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div></AppShell>;

  const s = data.summary;
  const trendTotal = data.collectionsTrend.reduce((n, d) => n + Number(d.total), 0);
  const trendMax = Math.max(1, ...data.collectionsTrend.map(d => Number(d.total)));

  return (
    <AppShell title="Insights" crumb="Insights">
      {/* Summary KPI strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12, marginBottom: 18,
      }}>
        <KpiCard label="Total outstanding" value={fmtINR(Number(s.total_outstanding))} mono />
        <KpiCard label="Accounts" value={String(s.total_accounts)} />
        <KpiCard label="Active holds" value={String(s.active_holds)} color="rust" />
        <KpiCard label="Critical (D/E)" value={String(s.critical_count)} color="amber" />
        <KpiCard label="Stale > 7d" value={String(s.stale_count)} color="muted" />
        <KpiCard label="Recovered (90d)" value={fmtINR(trendTotal)} mono color="sage" />
      </div>

      {/* Collections trend sparkline */}
      <Card>
        <CardHead>Collections trend · last 90 days</CardHead>
        <div style={{ padding: 18 }}>
          {data.collectionsTrend.length === 0 ? (
            <div style={{ color: 'var(--t-3)', fontSize: 13 }}>No collection events in this window.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
              {data.collectionsTrend.map(d => {
                const h = Math.max(2, Math.round(Number(d.total) / trendMax * 100));
                return (
                  <div key={d.day} title={`${d.day}: ${fmtINR(Number(d.total))}`}
                       style={{ flex: 1, background: 'var(--sage)', borderRadius: 2, height: `${h}%`, opacity: .75 }} />
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Two-column tables */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
        <Card>
          <CardHead>Top accounts by exposure</CardHead>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {data.topAccounts.map(a => (
                <tr key={a.id} onClick={() => setOpenId(a.id)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '10px 14px', width: 44 }}><TierBadge tier={a.tier} /></td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{a.party}</div>
                    <div style={{ fontSize: 11, color: 'var(--t-3)' }}>{a.family || '—'} · {a.exec || 'no exec'}</div>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{fmtINR(Number(a.bill))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHead>Family concentration</CardHead>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {data.families.map(f => {
                const pct = Math.round(Number(f.total) / Number(s.total_outstanding) * 100);
                return (
                  <tr key={f.family} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{f.family}</div>
                      <div style={{ fontSize: 11, color: 'var(--t-3)' }}>{f.account_count} account{f.account_count === 1 ? '' : 's'} · {pct}% of book</div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{fmtINR(Number(f.total))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

function KpiCard({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: 'rust' | 'amber' | 'sage' | 'muted' }) {
  const colorMap: Record<string, string> = {
    rust: 'var(--rust)', amber: 'var(--amber)', sage: 'var(--sage)', muted: 'var(--t-2)',
  };
  return (
    <div style={{ background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 600, marginTop: 8,
        color: color ? colorMap[color] : 'var(--navy-deep)',
        fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
      }}>{value}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <div style={{ background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, overflow: 'hidden' }}>{children}</div>; }
function CardHead({ children }: { children: React.ReactNode }) { return <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line, #e7eaf0)', fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</div>; }
