// ============================================================
// /portal/team-worklist — manager's morning view.
// ============================================================
// Top: one card per visible exec with key stats.
//   Click a card → expands an account list below filtered to that
//   exec, sorted by hold-status then outstanding.
//   Click an account row → opens the AccountDrawer.
//
// Visible cards are scoped by user role server-side; this page
// just renders whatever /api/team-worklist returns.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR } from '../../lib/fmt';

type ExecStat = {
  exec: string;
  accounts: number;
  outstanding: number;
  activeHolds: number;
  holdCandidates: number;
  criticalCount: number;
  staleCount: number;
  overduePromises: number;
};

type AccountRow = {
  id: string;
  party: string;
  family: string | null;
  exec: string | null;
  cm: string | null;
  tier: string;
  alert: string | null;
  bill: string | number;
  onHold: string | null;
  stage: string | null;
};

export default function TeamWorklistPage() {
  const [execs, setExecs] = useState<ExecStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drill-down state
  const [selectedExec, setSelectedExec] = useState<string | null>(null);
  const [drillRows, setDrillRows] = useState<AccountRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // Drawer state
  const [openId, setOpenId] = useState<string | null>(null);

  // Initial summary fetch
  useEffect(() => {
    fetch('/api/team-worklist')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setExecs(r.data.execs || []);
      })
      .catch(e => setError(e.message));
  }, []);

  // Drill-down fetch when an exec card is clicked
  useEffect(() => {
    if (!selectedExec) { setDrillRows([]); return; }
    setDrillLoading(true);
    fetch(`/api/accounts?exec=${encodeURIComponent(selectedExec)}&limit=200`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load accounts');
        setDrillRows(r.data.accounts || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setDrillLoading(false));
  }, [selectedExec]);

  return (
    <AppShell title="Team Worklist" crumb="Team Worklist">
      {error && (
        <div style={{ color: 'var(--rust)', padding: 16, marginBottom: 18 }}>Failed: {error}</div>
      )}

      {execs === null && !error && (
        <div style={{ padding: 40, color: 'var(--t-3)' }}>Loading team summary…</div>
      )}

      {execs && execs.length === 0 && (
        <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No execs to display</h3>
          <p style={{ color: 'var(--t-2)' }}>
            No accounts are currently assigned to executives in your team scope.
            Once accounts are uploaded and assigned, this view will populate automatically.
          </p>
        </div>
      )}

      {execs && execs.length > 0 && (
        <>
          {/* Exec cards grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}>
            {execs.map(e => (
              <ExecCard
                key={e.exec}
                stat={e}
                active={selectedExec === e.exec}
                onClick={() => setSelectedExec(prev => prev === e.exec ? null : e.exec)}
              />
            ))}
          </div>

          {/* Drill-down table */}
          {selectedExec && (
            <div style={{
              background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
              borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{
                padding: '14px 20px', borderBottom: '1px solid var(--line, #e7eaf0)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--bg-2, #f6f8fb)',
              }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 2 }}>
                    Account list
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--navy-deep)' }}>
                    {selectedExec}'s book · {drillRows.length} account{drillRows.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedExec(null)}
                  style={{
                    border: '1px solid var(--line, #e7eaf0)', background: 'transparent',
                    padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    color: 'var(--t-2)',
                  }}
                >Close</button>
              </div>

              {drillLoading && <div style={{ padding: 24, color: 'var(--t-3)' }}>Loading accounts…</div>}

              {!drillLoading && drillRows.length === 0 && (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--t-3)' }}>
                  No accounts found for {selectedExec}.
                </div>
              )}

              {!drillLoading && drillRows.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                      <Th>Tier</Th>
                      <Th>Party</Th>
                      <Th>Family</Th>
                      <Th align="right">Outstanding</Th>
                      <Th>Hold</Th>
                      <Th>Stage</Th>
                      <Th>Alert</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillRows.map(r => (
                      <tr
                        key={r.id}
                        onClick={() => setOpenId(r.id)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Td><TierBadge tier={r.tier} /></Td>
                        <Td><strong style={{ color: 'var(--navy-deep)' }}>{r.party}</strong></Td>
                        <Td>{r.family || '—'}</Td>
                        <Td align="right" mono>{fmtINR(Number(r.bill))}</Td>
                        <Td><HoldPill status={r.onHold} /></Td>
                        <Td>{r.stage || '—'}</Td>
                        <Td>{r.alert || '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

// ─── Exec card ────────────────────────────────────────────────
function ExecCard({ stat, active, onClick }: { stat: ExecStat; active: boolean; onClick: () => void }) {
  const danger = stat.activeHolds + stat.overduePromises;
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', cursor: 'pointer',
        background: active ? 'var(--navy-deep)' : 'var(--bg-1, #fff)',
        color: active ? '#fff' : 'inherit',
        border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)',
        borderRadius: 12, padding: '16px 18px',
        boxShadow: active ? '0 4px 14px rgba(11,22,41,.15)' : 'none',
        transition: 'all .12s ease',
      }}
    >
      <div style={{
        fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase',
        color: active ? 'rgba(255,255,255,.6)' : 'var(--t-3)',
        fontWeight: 700, marginBottom: 6,
      }}>
        Executive
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: active ? '#fff' : 'var(--navy-deep)' }}>
        {stat.exec}
      </div>

      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 18, fontWeight: 600,
        color: active ? '#fff' : 'var(--navy-deep)',
        marginBottom: 4,
      }}>
        {fmtINR(stat.outstanding)}
      </div>
      <div style={{
        fontSize: 11, color: active ? 'rgba(255,255,255,.7)' : 'var(--t-3)',
        marginBottom: 12,
      }}>
        across {stat.accounts} account{stat.accounts === 1 ? '' : 's'}
      </div>

      {/* Bottom stat row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
        paddingTop: 10, borderTop: `1px solid ${active ? 'rgba(255,255,255,.15)' : 'var(--line, #e7eaf0)'}`,
      }}>
        <StatPill label="Overdue"  value={stat.overduePromises}     color={active ? 'rgba(255,255,255,.85)' : 'var(--rust)'}  active={active} />
        <StatPill label="Active"   value={stat.activeHolds}          color={active ? 'rgba(255,255,255,.85)' : 'var(--rust)'}  active={active} />
        <StatPill label="Candidate" value={stat.holdCandidates}     color={active ? 'rgba(255,255,255,.85)' : 'var(--amber)'} active={active} />
        <StatPill label="Stale"    value={stat.staleCount}           color={active ? 'rgba(255,255,255,.85)' : 'var(--t-2)'}   active={active} />
      </div>
    </button>
  );
}

function StatPill({ label, value, color, active }: { label: string; value: number; color: string; active: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: active ? 'rgba(255,255,255,.55)' : 'var(--t-3)', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ─── Tiny shared bits ─────────────────────────────────────────
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align || 'left',
      padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700,
    }}>{children}</th>
  );
}

function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle',
      fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
    }}>{children}</td>
  );
}

function HoldPill({ status }: { status: string | null }) {
  if (!status) {
    return <span style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 600 }}>Clear</span>;
  }
  const map: Record<string, { bg: string; fg: string }> = {
    Active:    { bg: 'rgba(178,79,55,.16)',  fg: 'var(--rust)' },
    Candidate: { bg: 'rgba(217,165,69,.18)', fg: 'var(--amber)' },
  };
  const s = map[status] || { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' };
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700,
      letterSpacing: '.12em', textTransform: 'uppercase',
      padding: '4px 8px', borderRadius: 6,
    }}>{status}</span>
  );
}
