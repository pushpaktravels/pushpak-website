// ============================================================
// /portal/reservations-performance — booking-desk leaderboard.
// ============================================================
// Phase 3, Reservations edition. Per-agent performance blending the
// three dimensions the owner asked for: OUTPUT (bookings, fare, money
// collected), ACCOUNTABILITY (Held→Ticketed conversion, collection %,
// plus live overdue / at-risk flags) and ENGAGEMENT (active portal
// time). Window selectable 7 / 30 / 90 days. Owner / admin only.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtINR, fmtDuration } from '../../lib/fmt';

type Agent = {
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
  activeSec: number;
};
type Totals = {
  bookings: number; fareBooked: number; collected: number;
  outstanding: number; overdue: number; atRisk: number;
};

const WINDOWS = [
  { key: 7,  label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
];

function pct(num: number, den: number): number | null {
  return den > 0 ? Math.round((num * 100) / den) : null;
}

export default function ReservationPerformancePage() {
  const [days, setDays] = useState(30);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAgents(null); setError(null);
    fetch(`/api/reservations/performance?days=${days}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setAgents(r.data.agents || []);
        setTotals(r.data.totals || null);
      })
      .catch(e => setError(e.message));
  }, [days]);

  const collRate = totals ? pct(totals.collected, totals.fareBooked) : null;

  return (
    <AppShell title="Desk Performance" crumb="Domestic Reservations">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Desk Performance</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55, maxWidth: 760 }}>
          How each booking agent is doing — what they produced, how reliably they ticket and collect, and how much live exposure sits on their desk. Output and engagement are for the selected window; overdue and at-risk are current, right now.
        </p>
      </div>

      {/* Window selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, padding: '12px 16px', background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12 }}>
        {WINDOWS.map(w => (
          <Chip key={w.key} active={days === w.key} onClick={() => setDays(w.key)}>{w.label}</Chip>
        ))}
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {/* Summary strip */}
      {totals && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Stat label="Bookings" value={String(totals.bookings)} />
          <Stat label="Fare booked" value={fmtINR(totals.fareBooked)} />
          <Stat label="Collected" value={fmtINR(totals.collected)} sub={collRate != null ? `${collRate}% of fare` : undefined} tone="sage" />
          <Stat label="Outstanding" value={fmtINR(totals.outstanding)} tone={totals.outstanding > 0 ? 'rust' : undefined} />
          <Stat label="Overdue" value={String(totals.overdue)} tone={totals.overdue > 0 ? 'rust' : undefined} />
          <Stat label="At risk (≤3d)" value={String(totals.atRisk)} tone={totals.atRisk > 0 ? 'amber' : undefined} />
        </div>
      )}

      {agents === null && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}

      {agents && agents.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No desk activity in this window</h3>
          <p style={{ color: 'var(--t-2)' }}>Once agents log bookings, their performance will appear here.</p>
        </div>
      )}

      {agents && agents.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Agent</Th>
                <Th align="right">Bookings</Th>
                <Th align="right">Fare booked</Th>
                <Th align="right">Collected</Th>
                <Th align="right">Conversion</Th>
                <Th align="right">Outstanding</Th>
                <Th align="right">Overdue</Th>
                <Th align="right">At risk</Th>
                <Th align="right">Active time</Th>
              </tr>
            </thead>
            <tbody>
              {agents.map(a => {
                const conv = pct(a.ticketed, a.bookings);
                const cRate = pct(a.collected, a.fareBooked);
                return (
                  <tr key={a.execId} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Td>
                      <strong style={{ color: 'var(--navy-deep)' }}>{a.name}</strong>
                      <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>{a.execId}</div>
                    </Td>
                    <Td align="right" mono>
                      {a.bookings}
                      {a.pax > a.bookings && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>{a.pax} pax</div>}
                    </Td>
                    <Td align="right" mono>{fmtINR(a.fareBooked)}</Td>
                    <Td align="right" mono>
                      <strong style={{ color: 'var(--sage)' }}>{fmtINR(a.collected)}</strong>
                      {cRate != null && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>{cRate}%</div>}
                    </Td>
                    <Td align="right" mono>
                      {conv != null ? <span>{conv}%</span> : '—'}
                      <div style={{ fontSize: 10, color: 'var(--t-3)' }}>
                        <span style={{ color: 'var(--sage)' }}>{a.ticketed}T</span>
                        {' · '}
                        <span style={{ color: '#B58430' }}>{a.held}H</span>
                        {a.cancelled > 0 && <>{' · '}<span>{a.cancelled}X</span></>}
                      </div>
                    </Td>
                    <Td align="right" mono>
                      <span style={{ color: a.outstanding > 0 ? 'var(--rust)' : 'var(--t-3)', fontWeight: a.outstanding > 0 ? 700 : 400 }}>
                        {a.outstanding > 0 ? fmtINR(a.outstanding) : '—'}
                      </span>
                    </Td>
                    <Td align="right" mono><Flag n={a.overdue} tone="rust" /></Td>
                    <Td align="right" mono><Flag n={a.atRisk} tone="amber" /></Td>
                    <Td align="right" mono><span style={{ color: a.activeSec > 0 ? 'var(--t-1)' : 'var(--t-3)' }}>{fmtDuration(a.activeSec)}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Flag({ n, tone }: { n: number; tone: 'rust' | 'amber' }) {
  if (n <= 0) return <span style={{ color: 'var(--t-3)' }}>—</span>;
  const c = tone === 'rust'
    ? { bg: 'rgba(181,72,61,.10)', fg: 'var(--rust, #B5483D)' }
    : { bg: 'rgba(217,165,69,.18)', fg: '#B58430' };
  return (
    <span style={{
      display: 'inline-block', minWidth: 22, textAlign: 'center',
      fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg,
      padding: '2px 8px', borderRadius: 999,
    }}>{n}</span>
  );
}
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'rust' | 'amber' | 'sage' }) {
  const color = tone === 'rust' ? 'var(--rust, #B5483D)' : tone === 'amber' ? '#B58430' : tone === 'sage' ? 'var(--sage, #2E6C54)' : 'var(--navy-deep)';
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: '14px 18px', minWidth: 150 }}>
      <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ background: active ? 'var(--navy-deep)' : 'transparent', color: active ? '#fff' : 'var(--t-2)', border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{children}</button>;
}
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '12px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return <td style={{ textAlign: align || 'left', padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? 'inherit' : undefined }}>{children}</td>;
}
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
