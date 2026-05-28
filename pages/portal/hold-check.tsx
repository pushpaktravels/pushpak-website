// ============================================================
// /portal/hold-check — booking team's quick-lookup tool.
// ============================================================
// Type 2+ characters of a client/family name → live list of
// matching accounts with hold status + outstanding + tier + exec.
// Click any row to open the AccountDrawer for full detail.
//
// Debounced 250ms so we don't hammer /api/hold-check on every key.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR } from '../../lib/fmt';

type Row = {
  id: string;
  party: string;
  family: string | null;
  exec: string | null;
  cm: string | null;
  bill: string | number;
  tier: string;
  onHold: string | null;
  alert: string | null;
  creditLimit: string | number;
  creditPeriod: string | null;
};

type HoldRow = {
  id: string;            // HoldRecord id
  party: string;
  family: string | null;
  outstanding: number;
  reason: string;
  status: 'Candidate' | 'Active';
  confirmedBy: string | null;
  confirmedOn: string | null;
  addedOn: string;
  accountId: string | null;
  exec: string | null;
  tier: string | null;
  bill: number;
  d90p: number;
};

export default function HoldCheckPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // The two boards below the search bar
  const [candidates, setCandidates] = useState<HoldRow[]>([]);
  const [active, setActive] = useState<HoldRow[]>([]);
  const [holdsLoading, setHoldsLoading] = useState(true);
  const [holdsError, setHoldsError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const confirm = useConfirm();

  async function loadHolds() {
    setHoldsLoading(true); setHoldsError(null);
    try {
      const r = await fetch('/api/holds/list').then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to load holds');
      setCandidates(r.candidates || []);
      setActive(r.active || []);
    } catch (e: any) {
      setHoldsError(e.message);
    } finally {
      setHoldsLoading(false);
    }
  }
  useEffect(() => { loadHolds(); }, []);

  async function changeHold(id: string, status: 'Active' | 'Released') {
    if (actingId) return;
    const verb = status === 'Active' ? 'approve and activate' : 'release';
    const ok = await confirm({
      title: status === 'Active' ? 'Activate hold?' : 'Release hold?',
      body: status === 'Active'
        ? 'Bookings for this party will be blocked once you confirm.'
        : 'New bookings will be allowed again once you confirm.',
      confirmLabel: status === 'Active' ? 'Activate' : 'Release',
      destructive: status === 'Active',
    });
    if (!ok) return;
    setActingId(id); setHoldsError(null);
    try {
      const r = await fetch(`/api/holds/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      await loadHolds();
    } catch (e: any) {
      setHoldsError(e.message);
    } finally {
      setActingId(null);
    }
  }

  // Debounced search.
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); setError(null); return; }
    const t = setTimeout(() => {
      setLoading(true); setError(null);
      fetch(`/api/hold-check?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json())
        .then(r => {
          if (!r?.ok) throw new Error(r?.error || 'Search failed');
          setRows(r.data || []);
        })
        .catch(e => { setError(e.message); setRows([]); })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <AppShell title="Hold Check" crumb="Hold Check">
      {/* Search bar */}
      <div style={{
        background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
        borderRadius: 12, padding: 18, marginBottom: 20,
      }}>
        <label style={{ display: 'block', fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 8 }}>
          Search by client or family name
        </label>
        <input
          type="text"
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="e.g. AGARWAL or RAJESH TRADERS"
          style={{
            width: '100%', fontSize: 15, padding: '12px 14px',
            border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
            outline: 'none', color: 'var(--navy-deep)',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 8 }}>
          {q.trim().length < 2
            ? 'Type at least 2 characters to begin'
            : loading
              ? 'Searching…'
              : `${rows.length} match${rows.length === 1 ? '' : 'es'}`}
        </div>
      </div>

      {/* Hold boards (always shown below the search bar) */}
      {holdsError && (
        <div style={{ color: 'var(--rust)', padding: 12, marginBottom: 12, fontSize: 13 }}>
          Failed to load holds: {holdsError}
        </div>
      )}
      <HoldBoard
        title="Hold candidates"
        subtitle="Flagged by execs — pending owner / CM approval"
        accent="amber"
        rows={candidates}
        loading={holdsLoading}
        actingId={actingId}
        onOpen={setOpenId}
        actions={(r) => (
          <>
            <BoardBtn variant="approve" onClick={() => changeHold(r.id, 'Active')}>Approve</BoardBtn>
            <BoardBtn variant="release" onClick={() => changeHold(r.id, 'Released')}>Drop</BoardBtn>
          </>
        )}
      />
      <HoldBoard
        title="On hold"
        subtitle="Bookings currently blocked — release once payment received"
        accent="rust"
        rows={active}
        loading={holdsLoading}
        actingId={actingId}
        onOpen={setOpenId}
        actions={(r) => (
          <BoardBtn variant="release" onClick={() => changeHold(r.id, 'Released')}>Release</BoardBtn>
        )}
      />

      {/* Search results */}
      {error && (
        <div style={{ color: 'var(--rust)', padding: 16 }}>Failed: {error}</div>
      )}

      {!error && q.trim().length >= 2 && !loading && rows.length === 0 && (
        <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No matching accounts</h3>
          <p style={{ color: 'var(--t-2)' }}>
            No client or family contains "<strong>{q}</strong>". This usually means the booking is safe to proceed — verify with accounts team if unsure.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{
          background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Tier</Th>
                <Th>Party</Th>
                <Th>Family</Th>
                <Th align="right">Outstanding</Th>
                <Th>Hold</Th>
                <Th>Alert</Th>
                <Th>Exec</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
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
                  <Td>{r.alert || '—'}</Td>
                  <Td>{r.exec || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer */}
      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

// ─── Tiny presentational bits ─────────────────────────────────
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
      fontFamily: mono ? "inherit" : undefined,
    }}>{children}</td>
  );
}

// ─── Hold boards ──────────────────────────────────────────────
function HoldBoard({
  title, subtitle, accent, rows, loading, actingId, onOpen, actions,
}: {
  title: string;
  subtitle: string;
  accent: 'amber' | 'rust';
  rows: HoldRow[];
  loading: boolean;
  actingId: string | null;
  onOpen: (id: string) => void;
  actions: (r: HoldRow) => React.ReactNode;
}) {
  const borderColor = accent === 'rust' ? 'rgba(178,79,55,.35)' : 'rgba(217,165,69,.35)';
  const badgeBg     = accent === 'rust' ? 'rgba(178,79,55,.16)' : 'rgba(217,165,69,.18)';
  const badgeFg     = accent === 'rust' ? 'var(--rust)' : 'var(--amber, #B58430)';

  const sumOutstanding = rows.reduce((s, r) => s + (r.bill || 0), 0);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.60)',
      border: `1px solid ${borderColor}`,
      borderRadius: 12, overflow: 'hidden',
      marginBottom: 18,
    }}>
      <div style={{
        padding: '12px 18px',
        display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
        borderBottom: '1px solid rgba(15,40,85,0.08)',
      }}>
        <div style={{
          padding: '3px 8px', borderRadius: 4,
          background: badgeBg, color: badgeFg,
          fontSize: 10, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase',
        }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{subtitle}</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-soft)' }}>
          {loading ? 'Loading…' : `${rows.length} party${rows.length === 1 ? '' : 'ies'} · ${fmtINR(sumOutstanding)} exposure`}
        </div>
      </div>
      {!loading && rows.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13, fontStyle: 'italic' }}>
          None right now.
        </div>
      )}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
              <Th>Party</Th>
              <Th>Reason</Th>
              <Th align="right">Outstanding</Th>
              <Th align="right">90+ stuck</Th>
              <Th>Exec</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.id}
                style={{ borderBottom: '1px solid rgba(15,40,85,0.04)' }}
              >
                <Td>
                  <button onClick={() => r.accountId && onOpen(r.accountId)}
                    disabled={!r.accountId}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      cursor: r.accountId ? 'pointer' : 'default',
                      fontWeight: 600, color: 'var(--navy-deep)',
                      textAlign: 'left', fontFamily: 'inherit', fontSize: 13,
                    }}>{r.party}</button>
                  {r.family && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{r.family}</div>}
                </Td>
                <Td>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{r.reason}</div>
                </Td>
                <Td align="right" mono>{fmtINR(r.bill)}</Td>
                <Td align="right" mono>
                  <span style={{ color: r.d90p > 0 ? 'var(--rust)' : 'var(--ink-soft)' }}>
                    {r.d90p > 0 ? fmtINR(r.d90p) : '—'}
                  </span>
                </Td>
                <Td>{r.exec || '—'}</Td>
                <Td align="right">
                  <div style={{
                    display: 'inline-flex', gap: 6,
                    opacity: actingId === r.id ? 0.5 : 1,
                    pointerEvents: actingId === r.id ? 'none' : 'auto',
                  }}>
                    {actions(r)}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BoardBtn({
  children, onClick, variant,
}: { children: React.ReactNode; onClick: () => void; variant: 'approve' | 'release' }) {
  const palette = variant === 'approve'
    ? { bg: 'rgba(178,79,55,.10)',  border: 'rgba(178,79,55,.4)',  color: 'var(--rust)' }
    : { bg: 'rgba(46,108,84,.10)',  border: 'rgba(46,108,84,.4)',  color: 'var(--sage, #2E6C54)' };
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
      background: palette.bg, border: `1px solid ${palette.border}`,
      color: palette.color,
      fontSize: 10.5, fontWeight: 700,
      letterSpacing: '.18em', textTransform: 'uppercase',
    }}>{children}</button>
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
