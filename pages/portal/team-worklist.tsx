// ============================================================
// /portal/team-worklist — manager's morning view (accordion).
// ============================================================
// Vertical list of horizontal rows, one per executive. Each row
// shows headline stats (outstanding · accounts · overdue / hold /
// stale counters). Clicking a row expands it inline to reveal a
// sortable account table directly beneath that row, so you never
// lose context by scrolling to the bottom.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
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
  id: string; party: string; family: string | null;
  exec: string | null; cm: string | null; tier: string;
  alert: string | null; bill: string | number;
  onHold: string | null; stage: string | null;
};

type SortKey = 'bill' | 'party' | 'tier' | 'onHold';
type SortDir = 'asc' | 'desc';

export default function TeamWorklistPage() {
  const [execs, setExecs] = useState<ExecStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rowsByExec, setRowsByExec] = useState<Record<string, AccountRow[]>>({});
  const [loadingExec, setLoadingExec] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Sort state (per-row); applied client-side
  const [sortKey, setSortKey] = useState<SortKey>('bill');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    fetch('/api/team-worklist')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setExecs(r.data.execs || []);
      })
      .catch(e => setError(e.message));
  }, []);

  async function loadExec(exec: string) {
    if (rowsByExec[exec]) return;
    setLoadingExec(exec);
    try {
      const r = await fetch(`/api/accounts?exec=${encodeURIComponent(exec)}&limit=500`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to load accounts');
      setRowsByExec(prev => ({ ...prev, [exec]: r.data.accounts || [] }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingExec(null);
    }
  }

  function toggle(exec: string) {
    setExpanded(prev => {
      const next = prev === exec ? null : exec;
      if (next) loadExec(next);
      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'party' || key === 'tier' ? 'asc' : 'desc');
    }
  }

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
            No accounts are currently assigned to executives in your scope.
          </p>
        </div>
      )}

      {execs && execs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {execs.map(e => (
            <ExecAccordionRow
              key={e.exec}
              stat={e}
              open={expanded === e.exec}
              rows={rowsByExec[e.exec] || []}
              loadingRows={loadingExec === e.exec}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={() => toggle(e.exec)}
              onSort={toggleSort}
              onOpenAccount={setOpenId}
            />
          ))}
        </div>
      )}

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

// ─── Accordion row (header + collapsible body) ───────────────
function ExecAccordionRow({
  stat, open, rows, loadingRows, sortKey, sortDir,
  onToggle, onSort, onOpenAccount,
}: {
  stat: ExecStat;
  open: boolean;
  rows: AccountRow[];
  loadingRows: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  onToggle: () => void;
  onSort: (k: SortKey) => void;
  onOpenAccount: (id: string) => void;
}) {
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av: any; let bv: any;
      switch (sortKey) {
        case 'bill':    av = Number(a.bill || 0); bv = Number(b.bill || 0); break;
        case 'party':   av = a.party.toLowerCase(); bv = b.party.toLowerCase(); break;
        case 'tier':    av = a.tier; bv = b.tier; break;
        case 'onHold':  av = a.onHold || ''; bv = b.onHold || ''; break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  return (
    <div style={{
      background: open ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.65)',
      border: `1px solid ${open ? 'rgba(15,40,85,0.22)' : 'rgba(15,40,85,0.10)'}`,
      borderRadius: 12, overflow: 'hidden',
      transition: 'border-color .12s, background .12s',
    }}>
      {/* Header bar */}
      <div
        role="button" tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '14px 18px', cursor: 'pointer',
        }}
      >
        <span style={{
          color: 'var(--ink-soft, #475569)', fontSize: 16,
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform .12s ease', width: 16,
        }}>›</span>

        <div style={{ minWidth: 0, flex: '0 1 280px' }}>
          <div style={{
            fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase',
            color: 'var(--ink-soft, #475569)', fontWeight: 700, marginBottom: 2,
          }}>Executive</div>
          <div style={{
            fontSize: 14.5, fontWeight: 700, color: 'var(--ink, #0F2855)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{stat.exec}</div>
        </div>

        <div style={{ flex: '0 1 200px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink, #0F2855)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtINR(stat.outstanding)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft, #475569)' }}>
            across {stat.accounts} account{stat.accounts === 1 ? '' : 's'}
          </div>
        </div>

        {/* 4 stat pills */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, alignItems: 'center' }}>
          <Stat n={stat.overduePromises} label="Overdue" color={stat.overduePromises > 0 ? 'var(--rust)'  : 'var(--ink-soft)'} />
          <Stat n={stat.activeHolds}     label="Active"  color={stat.activeHolds     > 0 ? 'var(--rust)'  : 'var(--ink-soft)'} />
          <Stat n={stat.holdCandidates}  label="Cand."   color={stat.holdCandidates  > 0 ? 'var(--amber)' : 'var(--ink-soft)'} />
          <Stat n={stat.staleCount}      label="Stale"   color={stat.staleCount      > 0 ? 'var(--amber)' : 'var(--ink-soft)'} />
        </div>
      </div>

      {/* Collapsible body */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(15,40,85,0.10)' }}>
          {loadingRows && <div style={{ padding: 24, color: 'var(--ink-soft)' }}>Loading accounts…</div>}
          {!loadingRows && sorted.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
              No accounts for {stat.exec}.
            </div>
          )}
          {!loadingRows && sorted.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(15,40,85,0.04)', borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
                  <SortableTh field="tier"   active={sortKey === 'tier'}   dir={sortDir} onSort={onSort}>Tier</SortableTh>
                  <SortableTh field="party"  active={sortKey === 'party'}  dir={sortDir} onSort={onSort}>Party</SortableTh>
                  <Th>Family</Th>
                  <SortableTh field="bill"   active={sortKey === 'bill'}   dir={sortDir} onSort={onSort} align="right">Outstanding</SortableTh>
                  <SortableTh field="onHold" active={sortKey === 'onHold'} dir={sortDir} onSort={onSort}>Hold</SortableTh>
                  <Th>Stage</Th>
                  <Th>Alert</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id}
                    onClick={() => onOpenAccount(r.id)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid rgba(15,40,85,0.04)' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(15,40,85,0.04)')}
                    onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
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
    </div>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 44 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div style={{ fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ─── Shared table bits ────────────────────────────────────────
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align || 'left',
      padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700,
    }}>{children}</th>
  );
}
function SortableTh({
  children, field, active, dir, onSort, align,
}: {
  children: React.ReactNode;
  field: SortKey;
  active: boolean; dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  return (
    <th style={{
      textAlign: align || 'left',
      padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: active ? 'var(--ink, #0F2855)' : 'var(--t-3)',
      fontWeight: 700, cursor: 'pointer', userSelect: 'none',
    }} onClick={() => onSort(field)}>
      {children}{' '}
      <span style={{ fontSize: 9, opacity: active ? 1 : 0.3 }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );
}
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '11px 14px', color: 'var(--t-1)', verticalAlign: 'middle',
      fontFamily: mono ? 'inherit' : undefined,
      fontVariantNumeric: mono ? 'tabular-nums' : undefined,
      fontWeight: mono ? 600 : undefined,
    }}>{children}</td>
  );
}
function HoldPill({ status }: { status: string | null }) {
  if (!status) return <span style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 600 }}>Clear</span>;
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
