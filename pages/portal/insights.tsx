// ============================================================
// /portal/insights — owner/analyst analytics dashboard.
// ============================================================
// Layout (top -> bottom):
//   ▸ Hero KPI strip (6 cards) — outstanding, recovered last 30d
//     with delta, kept rate, active holds, critical exposure, stale.
//   ▸ Recovery leaderboard — primary view per user's brief:
//     execs ranked by recovered$ with calls + kept-rate alongside.
//   ▸ Recovery trend (line) + Promise outcomes (donut) — split row.
//   ▸ Aging mix bar — current snapshot of where the book sits.
//   ▸ Concentration: top accounts + family concentration — split.
//   ▸ Watchlists: stale (no touch >7d) + critical D/E — split.
//
// All number rendering uses fmtINR; click an account row in any
// list to open the AccountDrawer.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR, fmtRelative } from '../../lib/fmt';

type Insights = {
  summary: {
    total_accounts: number;
    total_outstanding: string | number;
    active_holds: number;
    critical_count: number;
    critical_value: string | number;
    stale_count: number;
  };
  recoveredLast30: number;
  recoveredPrev30: number;
  callsCurrent: number;
  callsPrev: number;
  keptRate: number | null;
  collectionsTrend: { day: string; total: string | number }[];
  promiseStats: { status: string; count: number }[];
  leaderboard: {
    exec: string; recovered: string | number; calls: number;
    promises_kept: number; promises_broken: number; promises_open: number; promises_total: number;
    accounts: number; outstanding: string | number;
    kept_rate: number | null;
  }[];
  agingMix: { d30: string; d60: string; d90: string; d90p: string };
  topAccounts: { id: string; party: string; family: string | null; exec: string | null; tier: string; bill: string | number; onHold: string | null }[];
  families: { family: string; account_count: number; total: string | number; active_holds: number }[];
  stale: { id: string; party: string; family: string | null; exec: string | null; tier: string; bill: string | number; lastTouched: string | null }[];
  critical: { id: string; party: string; family: string | null; exec: string | null; tier: string; bill: string | number; onHold: string | null; status: string }[];
  holds: { active_count: number; candidate_count: number; active_value: string | number; candidate_value: string | number };
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
  const totalBook = Number(s.total_outstanding);
  const recoveryDelta = data.recoveredLast30 - data.recoveredPrev30;
  const recoveryDeltaPct = data.recoveredPrev30 === 0
    ? null
    : Math.round((recoveryDelta / data.recoveredPrev30) * 100);
  const callsDelta = data.callsCurrent - data.callsPrev;

  // Aging mix breakdown
  const aging = [
    { label: '≤30d', value: Number(data.agingMix.d30), color: 'var(--sage)' },
    { label: '≤60d', value: Number(data.agingMix.d60), color: 'var(--amber)' },
    { label: '≤90d', value: Number(data.agingMix.d90), color: '#D97757' },
    { label: '>90d', value: Number(data.agingMix.d90p), color: 'var(--rust)' },
  ];
  const agingTotal = aging.reduce((n, b) => n + b.value, 0) || 1;

  // Promise mix
  const promiseMap = Object.fromEntries(data.promiseStats.map(p => [p.status, p.count]));
  const pOpen = promiseMap.Open || 0;
  const pKept = promiseMap.Kept || 0;
  const pBroken = promiseMap.Broken || 0;
  const pCancelled = promiseMap.Cancelled || 0;
  const pTotal = pOpen + pKept + pBroken + pCancelled || 1;

  // Trend max for bar scaling
  const trendMax = Math.max(1, ...data.collectionsTrend.map(d => Number(d.total)));
  const trendTotal = data.collectionsTrend.reduce((n, d) => n + Number(d.total), 0);

  // Leaderboard max for bar scaling
  const lbMax = Math.max(1, ...data.leaderboard.map(l => Number(l.recovered)));

  return (
    <AppShell title="Insights" crumb="Analytics">
      {/* HERO KPI STRIP */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 12, marginBottom: 18,
      }}>
        <Kpi label="Total outstanding" value={fmtINR(totalBook)} mono />
        <Kpi
          label="Recovered · 30d"
          value={fmtINR(data.recoveredLast30)}
          mono color="sage"
          delta={recoveryDeltaPct != null ? {
            value: recoveryDeltaPct,
            label: recoveryDeltaPct >= 0 ? `↑ ${recoveryDeltaPct}% vs prev 30d` : `↓ ${Math.abs(recoveryDeltaPct)}% vs prev 30d`,
            positive: recoveryDeltaPct >= 0,
          } : undefined}
        />
        <Kpi
          label="Calls · 30d"
          value={String(data.callsCurrent)}
          delta={data.callsPrev > 0 ? {
            value: callsDelta,
            label: callsDelta >= 0 ? `↑ ${callsDelta} vs prev 30d` : `↓ ${Math.abs(callsDelta)} vs prev 30d`,
            positive: callsDelta >= 0,
          } : undefined}
        />
        <Kpi label="Promise kept rate" value={data.keptRate == null ? '—' : `${data.keptRate}%`} color={data.keptRate != null && data.keptRate >= 70 ? 'sage' : data.keptRate != null && data.keptRate < 40 ? 'rust' : 'amber'} />
        <Kpi label="Active holds" value={String(data.holds.active_count)} hint={fmtINR(Number(data.holds.active_value))} color="rust" />
        <Kpi label="At risk (D/E)" value={fmtINR(Number(s.critical_value))} mono color="amber" hint={`${s.critical_count} accounts · ${Math.round(Number(s.critical_value) / totalBook * 100) || 0}% of book`} />
      </div>

      {/* LEADERBOARD (recovery focus) */}
      <Card>
        <CardHead title="Team recovery leaderboard" subtitle="Last 30 days · ranked by amount recovered" />
        {data.leaderboard.length === 0 ? (
          <Empty body="No team activity in the last 30 days." />
        ) : (
          <div style={{ padding: '8px 0' }}>
            {data.leaderboard.map((row, i) => {
              const widthPct = Math.max(2, (Number(row.recovered) / lbMax) * 100);
              const keptRate = row.kept_rate;
              return (
                <div key={row.exec} style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 130px 1fr 90px 90px 110px',
                  gap: 14, alignItems: 'center',
                  padding: '12px 22px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line, #e7eaf0)',
                }}>
                  <Rank pos={i + 1} />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--navy-deep)', fontSize: 13 }}>{row.exec}</div>
                    <div style={{ fontSize: 11, color: 'var(--t-3)' }}>{row.accounts} account{row.accounts === 1 ? '' : 's'} · {fmtINR(Number(row.outstanding))}</div>
                  </div>
                  {/* Recovery bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                      <span style={{ color: 'var(--t-3)' }}>Recovered</span>
                      <span style={{ fontFamily: "inherit", fontWeight: 600, color: 'var(--sage)' }}>{fmtINR(Number(row.recovered))}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--bg-2, #f6f8fb)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        width: `${widthPct}%`, height: '100%',
                        background: 'linear-gradient(90deg, var(--sage), #4FA078)',
                        borderRadius: 3,
                      }} />
                    </div>
                  </div>
                  <Stat label="Calls" value={String(row.calls)} />
                  <Stat label="Promises" value={`${row.promises_kept}/${row.promises_total}`} />
                  <Stat
                    label="Kept rate"
                    value={keptRate == null ? '—' : `${keptRate}%`}
                    color={keptRate == null ? undefined : keptRate >= 70 ? 'sage' : keptRate < 40 ? 'rust' : 'amber'}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* RECOVERY TREND + PROMISE OUTCOMES */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14, marginTop: 16 }}>
        <Card>
          <CardHead title="Recovery trend · last 90 days" subtitle={`Total ${fmtINR(trendTotal)}`} />
          <div style={{ padding: '18px 22px 22px' }}>
            {data.collectionsTrend.length === 0 ? (
              <div style={{ color: 'var(--t-3)', fontSize: 13 }}>No collection events in this window.</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
                {data.collectionsTrend.map(d => {
                  const h = Math.max(2, Math.round(Number(d.total) / trendMax * 100));
                  return (
                    <div key={d.day} title={`${d.day}: ${fmtINR(Number(d.total))}`}
                         style={{
                           flex: 1, background: 'var(--sage)',
                           borderRadius: '2px 2px 0 0', height: `${h}%`,
                           opacity: 0.78, transition: 'opacity .15s',
                         }}
                         onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                         onMouseLeave={e => (e.currentTarget.style.opacity = '0.78')} />
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Promise outcomes" subtitle="Last 90 days" />
          <div style={{ padding: '20px 22px 22px' }}>
            <PromiseDonut open={pOpen} kept={pKept} broken={pBroken} cancelled={pCancelled} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18, fontSize: 12 }}>
              <Legend color="var(--sage)"  label="Kept"      value={pKept}      pct={Math.round(pKept / pTotal * 100)} />
              <Legend color="var(--rust)"  label="Broken"    value={pBroken}    pct={Math.round(pBroken / pTotal * 100)} />
              <Legend color="var(--amber)" label="Open"      value={pOpen}      pct={Math.round(pOpen / pTotal * 100)} />
              <Legend color="var(--t-3)"   label="Cancelled" value={pCancelled} pct={Math.round(pCancelled / pTotal * 100)} />
            </div>
          </div>
        </Card>
      </div>

      {/* AGING MIX */}
      <Card style={{ marginTop: 16 }}>
        <CardHead title="Aging mix" subtitle="Current snapshot · where the book sits today" />
        <div style={{ padding: '18px 22px 22px' }}>
          {/* Stacked bar */}
          <div style={{ display: 'flex', height: 36, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            {aging.map(b => {
              const pct = (b.value / agingTotal) * 100;
              if (pct < 0.5) return null;
              return (
                <div key={b.label} style={{
                  width: `${pct}%`, background: b.color, position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff',
                  letterSpacing: '.06em',
                }} title={`${b.label}: ${fmtINR(b.value)} (${pct.toFixed(1)}%)`}>
                  {pct >= 8 ? `${pct.toFixed(0)}%` : ''}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {aging.map(b => (
              <div key={b.label} style={{ borderLeft: `3px solid ${b.color}`, paddingLeft: 12 }}>
                <div style={{ fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 4 }}>{b.label}</div>
                <div style={{ fontFamily: "inherit", fontSize: 16, fontWeight: 600, color: 'var(--navy-deep)' }}>{fmtINR(b.value)}</div>
                <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>{((b.value / agingTotal) * 100).toFixed(1)}% of book</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* CONCENTRATION */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
        <Card>
          <CardHead title="Top accounts by exposure" />
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
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: "inherit" }}>{fmtINR(Number(a.bill))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHead title="Family concentration" />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {data.families.map(f => {
                const pct = Math.round(Number(f.total) / totalBook * 100);
                return (
                  <tr key={f.family} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{f.family}</div>
                      <div style={{ fontSize: 11, color: 'var(--t-3)' }}>
                        {f.account_count} account{f.account_count === 1 ? '' : 's'} · {pct}% of book
                        {f.active_holds > 0 && <span style={{ color: 'var(--rust)' }}> · {f.active_holds} active hold{f.active_holds === 1 ? '' : 's'}</span>}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: "inherit" }}>{fmtINR(Number(f.total))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {/* WATCHLISTS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
        <Card>
          <CardHead title="Stale watchlist" subtitle="No contact in 7+ days · ordered by exposure" />
          {data.stale.length === 0 ? (
            <Empty body="No stale accounts. Every account touched within the week." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {data.stale.map(a => (
                  <tr key={a.id} onClick={() => setOpenId(a.id)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '10px 14px', width: 44 }}><TierBadge tier={a.tier} /></td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{a.party}</div>
                      <div style={{ fontSize: 11, color: 'var(--t-3)' }}>
                        Last touched {a.lastTouched ? fmtRelative(a.lastTouched) : 'never'} · {a.exec || 'no exec'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: "inherit" }}>{fmtINR(Number(a.bill))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHead title="Critical accounts (D / E)" subtitle="Highest-risk tiers · ranked by exposure" />
          {data.critical.length === 0 ? (
            <Empty body="No D/E tier accounts. Book is healthy." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {data.critical.map(a => (
                  <tr key={a.id} onClick={() => setOpenId(a.id)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '10px 14px', width: 44 }}><TierBadge tier={a.tier} /></td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{a.party}</div>
                      <div style={{ fontSize: 11, color: 'var(--t-3)' }}>
                        {a.status} · {a.exec || 'no exec'}
                        {a.onHold && <span style={{ color: 'var(--rust)' }}> · {a.onHold} hold</span>}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: "inherit" }}>{fmtINR(Number(a.bill))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

// ─── Building blocks ─────────────────────────────────────────
function Kpi({
  label, value, mono, color, hint, delta,
}: {
  label: string; value: string; mono?: boolean;
  color?: 'rust' | 'amber' | 'sage' | 'muted';
  hint?: string;
  delta?: { value: number; label: string; positive: boolean };
}) {
  const colorMap: Record<string, string> = {
    rust: 'var(--rust)', amber: 'var(--amber)', sage: 'var(--sage)', muted: 'var(--t-2)',
  };
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--line, #e7eaf0)',
      borderRadius: 14, padding: 16, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.28em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 700, marginTop: 10,
        color: color ? colorMap[color] : 'var(--navy-deep)',
        fontFamily: mono ? "inherit" : undefined,
        letterSpacing: mono ? '-.01em' : '-.014em',
        lineHeight: 1.1,
      }}>{value}</div>
      {delta && (
        <div style={{
          fontSize: 10.5, marginTop: 6, fontWeight: 600,
          color: delta.positive ? 'var(--sage)' : 'var(--rust)',
        }}>{delta.label}</div>
      )}
      {hint && !delta && <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--line, #e7eaf0)',
      borderRadius: 14, overflow: 'hidden', ...style,
    }}>{children}</div>
  );
}

function CardHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{
      padding: '14px 22px', borderBottom: '1px solid var(--line, #e7eaf0)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
    }}>
      <span style={{ fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--navy-deep)', fontWeight: 700 }}>{title}</span>
      {subtitle && <span style={{ fontSize: 11, color: 'var(--t-3)' }}>{subtitle}</span>}
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return <div style={{ padding: 22, color: 'var(--t-3)', fontSize: 13 }}>{body}</div>;
}

function Rank({ pos }: { pos: number }) {
  const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : null;
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      background: pos <= 3 ? 'transparent' : 'var(--bg-2, #f6f8fb)',
      color: 'var(--t-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: medal ? 18 : 13,
    }}>{medal || pos}</div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: 'rust' | 'amber' | 'sage' }) {
  const c = color === 'rust' ? 'var(--rust)' : color === 'amber' ? 'var(--amber)' : color === 'sage' ? 'var(--sage)' : 'var(--navy-deep)';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: c, fontFamily: "inherit" }}>{value}</div>
    </div>
  );
}

function Legend({ color, label, value, pct }: { color: string; label: string; value: number; pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ color: 'var(--t-2)', flex: 1 }}>{label}</span>
      <span style={{ color: 'var(--t-3)' }}>{pct}%</span>
      <span style={{ fontFamily: "inherit", color: 'var(--navy-deep)', fontWeight: 600, minWidth: 24, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ─── Promise donut ───────────────────────────────────────────
function PromiseDonut({ open, kept, broken, cancelled }: { open: number; kept: number; broken: number; cancelled: number }) {
  const total = open + kept + broken + cancelled || 1;
  // Build SVG donut with conic segments
  const segments = [
    { value: kept,      color: 'var(--sage)' },
    { value: broken,    color: 'var(--rust)' },
    { value: open,      color: 'var(--amber)' },
    { value: cancelled, color: 'var(--t-3)' },
  ];
  const r = 52, cx = 70, cy = 70, sw = 18;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 140, height: 140 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-2, #f6f8fb)" strokeWidth={sw} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const length = frac * circumference;
          const dashArray = `${length} ${circumference - length}`;
          const dashOffset = -offset;
          offset += length;
          if (seg.value === 0) return null;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                    stroke={seg.color} strokeWidth={sw}
                    strokeDasharray={dashArray} strokeDashoffset={dashOffset}
                    transform={`rotate(-90 ${cx} ${cy})`} />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--navy-deep)" fontFamily="inherit">
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="var(--t-3)" letterSpacing=".18em">
          PROMISES
        </text>
      </svg>
    </div>
  );
}
