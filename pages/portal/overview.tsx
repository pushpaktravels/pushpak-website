// ============================================================
// /portal/overview — the owner's Command Center.
// ============================================================
// Company-wide financials + workforce + attendance + team
// performance in one screen. Owners only (gated server-side on
// the 'overview' view in lib/views.ts + /api/overview).
//
// Honest about coverage: real PERFORMANCE numbers exist only for
// the Accounts/Followup team today. Every employee has ATTENDANCE
// data. Other departments (visa / packages / reservations) surface
// headcount + attendance only until their performance
// instrumentation lands in a later phase — the page says so.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtINR, fmtDate } from '../../lib/fmt';
import { roleLabel } from '../../lib/roles';

type Overview = {
  company: {
    totalOutstanding: number; accounts: number;
    aging: { d30: number; d60: number; d90: number; d90p: number };
    holdsActive: number; holdsCandidate: number;
    holdsActiveValue: number; holdsCandidateValue: number;
    criticalCount: number; criticalValue: number; staleCount: number;
    recovered30: number; recoveredPrev30: number;
    legalOpenCases: number; legalExposure: number;
    promiseKept: number; promiseBroken: number; promiseOpen: number;
    keptRate: number | null;
  };
  trend: { week: string; total: number }[];
  workforce: { role: string; count: number }[];
  attendance: {
    asOf: string | null;
    today: { present: number; late: number; halfDay: number; absent: number; leave: number; offDay: number };
    byDept: { department: string; headcount: number; presentDays: number; lateDays: number; absentDays: number; leaveDays: number; markedDays: number }[];
    concerns: { name: string; department: string; absents: number; lates: number }[];
  };
  leaderboard: { exec: string; recovered: number; recoveryCount: number; calls: number }[];
  reservations: {
    days: number;
    totals: { bookings: number; fareBooked: number; collected: number; outstanding: number; overdue: number; atRisk: number };
    agents: { execId: string; name: string; bookings: number; fareBooked: number; collected: number; outstanding: number }[];
  } | null;
};

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/overview')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setData(r.data);
      })
      .catch(e => setError(e.message));
  }, []);

  return (
    <AppShell title="Command Center" crumb="Command Center">
      {error && <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div>}
      {!data && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading the whole company…</div>}

      {data && <Dashboard d={data} />}
    </AppShell>
  );
}

function Dashboard({ d }: { d: Overview }) {
  const c = d.company;
  const recDelta = c.recovered30 - c.recoveredPrev30;
  const recPct = c.recoveredPrev30 > 0 ? Math.round((recDelta / c.recoveredPrev30) * 100) : null;
  const agingTotal = c.aging.d30 + c.aging.d60 + c.aging.d90 + c.aging.d90p;
  const att = d.attendance.today;
  const attTotal = att.present + att.late + att.halfDay + att.absent + att.leave + att.offDay;
  const trendMax = Math.max(1, ...d.trend.map(t => t.total));
  const workforceTotal = d.workforce.reduce((s, w) => s + w.count, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* ── Company money strip ── */}
      <Section title="Company at a glance" sub="The whole receivables book, live.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Kpi label="Total outstanding" value={fmtINR(c.totalOutstanding)} sub={`${c.accounts.toLocaleString('en-IN')} accounts`} tone="navy" />
          <Kpi
            label="Recovered (30d)" value={fmtINR(c.recovered30)} tone="sage"
            sub={recPct == null
              ? `prev 30d ${fmtINR(c.recoveredPrev30)}`
              : `${recDelta >= 0 ? '▲' : '▼'} ${Math.abs(recPct)}% vs prev 30d`}
            subTone={recDelta >= 0 ? 'sage' : 'rust'}
          />
          <Kpi label="Critical (tier D/E)" value={fmtINR(c.criticalValue)} sub={`${c.criticalCount.toLocaleString('en-IN')} accounts`} tone="rust" />
          <Kpi label="Legal exposure" value={fmtINR(c.legalExposure)} sub={`${c.legalOpenCases} open case${c.legalOpenCases === 1 ? '' : 's'}`} tone="rust" />
          <Kpi label="On hold (active)" value={fmtINR(c.holdsActiveValue)} sub={`${c.holdsActive} held · ${c.holdsCandidate} candidate`} tone="gold" />
          <Kpi label="Stale (7d+ untouched)" value={c.staleCount.toLocaleString('en-IN')} sub="accounts needing a touch" tone={c.staleCount > 0 ? 'gold' : 'navy'} />
        </div>
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 22 }} className="cc-split">
        {/* ── Collections trend ── */}
        <Section title="Weekly collections" sub="Last 12 weeks of recovered cash.">
          {d.trend.length === 0
            ? <Empty>No collections logged yet.</Empty>
            : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150, padding: '4px 0' }}>
                {d.trend.map(t => (
                  <div key={t.week} title={`${fmtDate(t.week)} · ${fmtINR(t.total)}`}
                       style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', height: 130 }}>
                      <div style={{
                        width: '100%', borderRadius: '4px 4px 0 0', background: 'var(--sage, #6b9f7e)',
                        height: `${Math.max(3, (t.total / trendMax) * 100)}%`,
                      }} />
                    </div>
                    <span style={{ fontSize: 9, color: 'var(--t-3)', whiteSpace: 'nowrap' }}>
                      {new Date(t.week).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
        </Section>

        {/* ── Aging + promises ── */}
        <Section title="Health of the book" sub="Where the money sits, and whether promises hold.">
          <div style={{ marginBottom: 14 }}>
            <Label>Aging</Label>
            <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', marginTop: 6 }}>
              <AgeSeg val={c.aging.d30} total={agingTotal} color="#6b9f7e" label="0–30" />
              <AgeSeg val={c.aging.d60} total={agingTotal} color="#c9a64b" label="31–60" />
              <AgeSeg val={c.aging.d90} total={agingTotal} color="#d08a4e" label="61–90" />
              <AgeSeg val={c.aging.d90p} total={agingTotal} color="#b2553f" label="90+" />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8, fontSize: 11, color: 'var(--t-2)' }}>
              <Legend color="#6b9f7e" label="0–30" v={c.aging.d30} />
              <Legend color="#c9a64b" label="31–60" v={c.aging.d60} />
              <Legend color="#d08a4e" label="61–90" v={c.aging.d90} />
              <Legend color="#b2553f" label="90+" v={c.aging.d90p} />
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--line, #e7eaf0)', paddingTop: 12 }}>
            <Label>Promises (last 90d settled)</Label>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, alignItems: 'baseline' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: c.keptRate == null ? 'var(--t-3)' : c.keptRate >= 70 ? 'var(--sage)' : c.keptRate >= 40 ? 'var(--gold, #c9a64b)' : 'var(--rust)' }}>
                {c.keptRate == null ? '—' : `${c.keptRate}%`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--t-2)' }}>kept-rate</div>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t-2)', textAlign: 'right' }}>
                <span style={{ color: 'var(--sage)' }}>{c.promiseKept} kept</span> ·{' '}
                <span style={{ color: 'var(--rust)' }}>{c.promiseBroken} broken</span><br />
                <span style={{ color: 'var(--t-3)' }}>{c.promiseOpen} open</span>
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* ── Workforce + attendance today ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 22 }} className="cc-split">
        <Section title="Workforce" sub={`${workforceTotal} active login${workforceTotal === 1 ? '' : 's'} by role.`}>
          {d.workforce.length === 0
            ? <Empty>No active users.</Empty>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[...d.workforce].sort((a, b) => b.count - a.count).map(w => (
                  <div key={w.role} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ width: 150, color: 'var(--t-1)' }}>{roleLabel(w.role)}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--bg-2, #f6f8fb)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(w.count / Math.max(1, workforceTotal)) * 100}%`, height: '100%', background: 'var(--navy-deep, #1f3a5f)' }} />
                    </div>
                    <span style={{ width: 28, textAlign: 'right', fontWeight: 700, color: 'var(--navy-deep)' }}>{w.count}</span>
                  </div>
                ))}
              </div>
            )}
        </Section>

        <Section
          title="Attendance today"
          sub={d.attendance.asOf ? `As of ${fmtDate(d.attendance.asOf)} · ${attTotal} marked` : 'No attendance marked yet.'}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 10 }}>
            <Pill label="Present" value={att.present} color="#6b9f7e" />
            <Pill label="Late" value={att.late} color="#c9a64b" />
            <Pill label="Half day" value={att.halfDay} color="#d08a4e" />
            <Pill label="Absent" value={att.absent} color="#b2553f" />
            <Pill label="Leave" value={att.leave} color="#7a8aa0" />
            <Pill label="Off / holiday" value={att.offDay} color="#aeb8c7" />
          </div>
        </Section>
      </div>

      {/* ── Attendance by department (month-to-date) ── */}
      <Section title="Attendance by department" sub="Month-to-date. Every department is covered here.">
        {d.attendance.byDept.length === 0
          ? <Empty>No active employees on record.</Empty>
          : (
            <Table head={['Department', 'Head', 'Present', 'Late', 'Absent', 'Leave', 'Attendance %']}>
              {d.attendance.byDept.map(dep => {
                const rate = dep.markedDays > 0 ? Math.round((dep.presentDays / dep.markedDays) * 100) : null;
                return (
                  <tr key={dep.department} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Td><strong style={{ color: 'var(--navy-deep)' }}>{dep.department}</strong></Td>
                    <Td align="right" mono>{dep.headcount}</Td>
                    <Td align="right" mono><span style={{ color: 'var(--sage)' }}>{dep.presentDays}</span></Td>
                    <Td align="right" mono><span style={{ color: dep.lateDays ? 'var(--gold, #c9a64b)' : 'var(--t-3)' }}>{dep.lateDays}</span></Td>
                    <Td align="right" mono><span style={{ color: dep.absentDays ? 'var(--rust)' : 'var(--t-3)' }}>{dep.absentDays}</span></Td>
                    <Td align="right" mono>{dep.leaveDays}</Td>
                    <Td align="right" mono>
                      {rate == null ? <span style={{ color: 'var(--t-3)' }}>—</span>
                        : <strong style={{ color: rate >= 90 ? 'var(--sage)' : rate >= 75 ? 'var(--gold, #c9a64b)' : 'var(--rust)' }}>{rate}%</strong>}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
      </Section>

      {/* ── Concerns + leaderboard ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 22 }} className="cc-split">
        <Section title="Attendance concerns" sub="Month-to-date: any absence, or 3+ lates.">
          {d.attendance.concerns.length === 0
            ? <Empty>Nothing flagged — clean month so far.</Empty>
            : (
              <Table head={['Employee', 'Dept', 'Absent', 'Late']}>
                {d.attendance.concerns.map((p, i) => (
                  <tr key={`${p.name}-${i}`} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Td><strong style={{ color: 'var(--navy-deep)' }}>{p.name}</strong></Td>
                    <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{p.department}</span></Td>
                    <Td align="right" mono><span style={{ color: p.absents ? 'var(--rust)' : 'var(--t-3)' }}>{p.absents}</span></Td>
                    <Td align="right" mono><span style={{ color: p.lates >= 3 ? 'var(--gold, #c9a64b)' : 'var(--t-3)' }}>{p.lates}</span></Td>
                  </tr>
                ))}
              </Table>
            )}
        </Section>

        <Section title="Accounts team leaderboard" sub="Recovered + activity, last 30 days.">
          {d.leaderboard.length === 0
            ? <Empty>No recovery activity in the last 30 days.</Empty>
            : (
              <Table head={['Exec', 'Recovered', 'Recoveries', 'Calls']}>
                {d.leaderboard.map((e, i) => (
                  <tr key={e.exec} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Td>
                      <span style={{ display: 'inline-block', width: 20, color: 'var(--t-3)', fontSize: 12 }}>{i + 1}.</span>
                      <strong style={{ color: 'var(--navy-deep)' }}>{e.exec}</strong>
                    </Td>
                    <Td align="right" mono><strong style={{ color: 'var(--sage)' }}>{fmtINR(e.recovered)}</strong></Td>
                    <Td align="right" mono>{e.recoveryCount}</Td>
                    <Td align="right" mono>{e.calls}</Td>
                  </tr>
                ))}
              </Table>
            )}
        </Section>
      </div>

      {/* ── Domestic Reservations desk (Phase 3 roll-up) ── */}
      {d.reservations && <ReservationsPanel r={d.reservations} />}

      {/* ── Honest coverage note ── */}
      <div style={{
        background: 'var(--bg-2, #f6f8fb)', border: '1px dashed var(--line, #e7eaf0)',
        borderRadius: 12, padding: '14px 16px', fontSize: 12.5, color: 'var(--t-2)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--navy-deep)' }}>About this data.</strong>{' '}
        Detailed <em>performance</em> numbers exist today for the Accounts / Followup team
        (recoveries, calls, promises) and the Domestic Reservations desk (bookings, ticketing,
        collection). Every department above is fully covered for <em>attendance</em>.
        Performance tracking for Visa and Packages is being instrumented next — once live, those
        teams will surface here the same way.
      </div>

      <style jsx>{`
        @media (max-width: 880px) {
          :global(.cc-split) { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Domestic Reservations desk roll-up ────────────────────────
// Mirrors the dedicated Desk Performance page in miniature: a money +
// accountability strip plus the top agents. Output (bookings / fare /
// collected) is the last-30d window; overdue & at-risk are live.
function ReservationsPanel({ r }: { r: NonNullable<Overview['reservations']> }) {
  const t = r.totals;
  const collRate = t.fareBooked > 0 ? Math.round((t.collected / t.fareBooked) * 100) : null;
  return (
    <Section
      title="Domestic Reservations desk"
      sub={`Booking, ticketing and collection — last ${r.days} days. Overdue & at-risk are live, right now.`}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="Bookings" value={t.bookings.toLocaleString('en-IN')} tone="navy" />
        <Kpi label="Fare booked" value={fmtINR(t.fareBooked)} tone="navy" />
        <Kpi label="Collected" value={fmtINR(t.collected)} tone="sage" sub={collRate == null ? undefined : `${collRate}% of fare`} subTone="sage" />
        <Kpi label="Outstanding" value={fmtINR(t.outstanding)} tone={t.outstanding > 0 ? 'rust' : 'navy'} />
        <Kpi label="Overdue" value={t.overdue.toLocaleString('en-IN')} sub="travelled, still owes" tone={t.overdue > 0 ? 'rust' : 'navy'} />
        <Kpi label="At risk (≤3d)" value={t.atRisk.toLocaleString('en-IN')} sub="held, travel near" tone={t.atRisk > 0 ? 'gold' : 'navy'} />
      </div>
      {r.agents.length === 0
        ? <Empty>No desk activity in this window.</Empty>
        : (
          <Table head={['Agent', 'Bookings', 'Fare booked', 'Collected', 'Outstanding']}>
            {r.agents.map((a, i) => (
              <tr key={a.execId} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Td>
                  <span style={{ display: 'inline-block', width: 20, color: 'var(--t-3)', fontSize: 12 }}>{i + 1}.</span>
                  <strong style={{ color: 'var(--navy-deep)' }}>{a.name}</strong>
                </Td>
                <Td align="right" mono>{a.bookings}</Td>
                <Td align="right" mono>{fmtINR(a.fareBooked)}</Td>
                <Td align="right" mono><strong style={{ color: 'var(--sage)' }}>{fmtINR(a.collected)}</strong></Td>
                <Td align="right" mono><span style={{ color: a.outstanding > 0 ? 'var(--rust)' : 'var(--t-3)' }}>{a.outstanding > 0 ? fmtINR(a.outstanding) : '—'}</span></Td>
              </tr>
            ))}
          </Table>
        )}
    </Section>
  );
}

// ── Small presentational helpers ──────────────────────────────

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
      borderRadius: 12, padding: 18,
    }}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-deep)', margin: 0 }}>{title}</h3>
        {sub && <p style={{ fontSize: 12, color: 'var(--t-3)', margin: '3px 0 0' }}>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, subTone, tone }: {
  label: string; value: string; sub?: string;
  subTone?: 'sage' | 'rust'; tone?: 'navy' | 'sage' | 'rust' | 'gold';
}) {
  const valColor = tone === 'sage' ? 'var(--sage)' : tone === 'rust' ? 'var(--rust)'
    : tone === 'gold' ? 'var(--gold, #c9a64b)' : 'var(--navy-deep)';
  const subColor = subTone === 'sage' ? 'var(--sage)' : subTone === 'rust' ? 'var(--rust)' : 'var(--t-3)';
  return (
    <div style={{ background: 'var(--bg-2, #f6f8fb)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: valColor, margin: '4px 0 2px', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subColor }}>{sub}</div>}
    </div>
  );
}

function Pill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'var(--bg-2, #f6f8fb)', borderRadius: 10, padding: '10px 12px', borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy-deep)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--t-2)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</div>;
}

function AgeSeg({ val, total, color, label }: { val: number; total: number; color: string; label: string }) {
  const pct = total > 0 ? (val / total) * 100 : 0;
  if (pct <= 0) return null;
  return <div title={`${label}: ${fmtINR(val)}`} style={{ width: `${pct}%`, background: color }} />;
}

function Legend({ color, label, v }: { color: string; label: string; v: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}: <strong style={{ color: 'var(--t-1)' }}>{fmtINR(v)}</strong>
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '20px 4px', color: 'var(--t-3)', fontSize: 13 }}>{children}</div>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
            {head.map((h, i) => (
              <th key={h} style={{
                textAlign: i === 0 ? 'left' : 'right', padding: '9px 12px', fontSize: 10,
                letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return <td style={{ textAlign: align || 'left', padding: '10px 12px', color: 'var(--t-1)', verticalAlign: 'middle', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}
