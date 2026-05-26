// ============================================================
// /portal/promises — Promise Ledger (account-grouped view).
// ============================================================
// One row per account that has at least one promise. Shows count
// by status + latest expected date + outstanding. Click → drawer
// where the full promise history for that account lives.
//
// Filter chips re-scope which promises count toward each row:
//   All / Open / Kept / Broken / Cancelled
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR, fmtDate } from '../../lib/fmt';

type PromiseRow = {
  id: string;
  party: string;
  family: string | null;
  expectedBy: string;
  exec: string | null;
  outstandingAt: string | number;
  status: 'Open' | 'Kept' | 'Broken' | 'Cancelled';
  amountReceived: string | number;
  account_id: string | null;
  tier: string | null;
  hold: string | null;
  days_overdue: number | null;
};

type AccountGroup = {
  accountId: string | null;
  party: string;
  family: string | null;
  exec: string | null;
  tier: string | null;
  counts: { Open: number; Kept: number; Broken: number; Cancelled: number };
  latestExpectedBy: string | null;
  latestStatus: 'Open' | 'Kept' | 'Broken' | 'Cancelled';
  totalAmount: number;
  daysOverdue: number | null;
};

const STATUSES: Array<'all' | 'Open' | 'Kept' | 'Broken' | 'Cancelled'> = ['all', 'Open', 'Kept', 'Broken', 'Cancelled'];

// Priority: Open (esp. overdue) > Broken > Kept > Cancelled
const STATUS_PRIORITY: Record<string, number> = { Open: 0, Broken: 1, Kept: 2, Cancelled: 3 };

export default function PromiseLedgerPage() {
  const [status, setStatus] = useState<typeof STATUSES[number]>('all');
  const [rows, setRows] = useState<PromiseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setError(null);
    fetch(`/api/promises?status=${status}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.promises || []);
      })
      .catch(e => setError(e.message));
  }, [status]);

  // Group rows by account (party) ─────────────────────────────
  const groups: AccountGroup[] = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, AccountGroup>();
    for (const r of rows) {
      const key = r.party;
      let g = map.get(key);
      if (!g) {
        g = {
          accountId: r.account_id, party: r.party, family: r.family,
          exec: r.exec, tier: r.tier,
          counts: { Open: 0, Kept: 0, Broken: 0, Cancelled: 0 },
          latestExpectedBy: r.expectedBy, latestStatus: r.status,
          totalAmount: 0, daysOverdue: null,
        };
        map.set(key, g);
      }
      g.counts[r.status]++;
      g.totalAmount += Number(r.outstandingAt || 0);

      // Track the most-pressing promise as the row's representative status
      const newer = !g.latestExpectedBy || new Date(r.expectedBy) > new Date(g.latestExpectedBy);
      const moreUrgent = STATUS_PRIORITY[r.status] < STATUS_PRIORITY[g.latestStatus];
      if (moreUrgent || (STATUS_PRIORITY[r.status] === STATUS_PRIORITY[g.latestStatus] && newer)) {
        g.latestExpectedBy = r.expectedBy;
        g.latestStatus = r.status;
      }
      if (r.status === 'Open' && r.days_overdue && r.days_overdue > 0) {
        if (g.daysOverdue == null || r.days_overdue > g.daysOverdue) g.daysOverdue = r.days_overdue;
      }
    }
    // Sort: Open first (most overdue first), then Broken, then Kept, then Cancelled.
    return Array.from(map.values()).sort((a, b) => {
      const pa = STATUS_PRIORITY[a.latestStatus] ?? 99;
      const pb = STATUS_PRIORITY[b.latestStatus] ?? 99;
      if (pa !== pb) return pa - pb;
      if (a.daysOverdue && b.daysOverdue) return b.daysOverdue - a.daysOverdue;
      return (b.latestExpectedBy || '').localeCompare(a.latestExpectedBy || '');
    });
  }, [rows]);

  return (
    <AppShell title="Promise Ledger" crumb="Promise Ledger">
      <FilterBar>
        {STATUSES.map(s => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
            {s === 'all' ? 'All' : s}
          </FilterChip>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t-3)' }}>
          {groups.length} account{groups.length === 1 ? '' : 's'} · {rows?.length ?? 0} promise{rows?.length === 1 ? '' : 's'}
        </div>
      </FilterBar>

      {error && <ErrorBox>{error}</ErrorBox>}
      {rows === null && !error && <Loading />}
      {rows && groups.length === 0 && <EmptyState
        title={status === 'all' ? 'No promises yet' : `No ${status.toLowerCase()} promises`}
        body="Promises appear here as they are added from the Account Drawer." />}

      {groups.length > 0 && (
        <Card>
          <table style={tableStyle}>
            <thead>
              <tr style={theadStyle}>
                <Th>Tier</Th>
                <Th>Party</Th>
                <Th>Family</Th>
                <Th>Latest expected</Th>
                <Th align="right">Total amount</Th>
                <Th>Promises</Th>
                <Th>Exec</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.party}
                    onClick={() => g.accountId && setOpenId(g.accountId)}
                    style={trStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Td>{g.tier ? <TierBadge tier={g.tier} /> : '—'}</Td>
                  <Td><strong style={{ color: 'var(--navy-deep)' }}>{g.party}</strong></Td>
                  <Td>{g.family || '—'}</Td>
                  <Td>
                    {g.latestExpectedBy ? fmtDate(g.latestExpectedBy) : '—'}
                    {g.daysOverdue && g.daysOverdue > 0 && (
                      <span style={{ marginLeft: 8, color: 'var(--rust)', fontSize: 11, fontWeight: 600 }}>
                        ↑ {g.daysOverdue}d overdue
                      </span>
                    )}
                  </Td>
                  <Td align="right" mono>{fmtINR(g.totalAmount)}</Td>
                  <Td><PromiseCounts counts={g.counts} /></Td>
                  <Td>{g.exec || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

// ─── Promise count chips ─────────────────────────────────────
function PromiseCounts({ counts }: { counts: Record<string, number> }) {
  const map: Record<string, { bg: string; fg: string }> = {
    Open:      { bg: 'rgba(176,127,28,.18)', fg: 'var(--amber)' },
    Kept:      { bg: 'rgba(46,125,92,.18)',  fg: 'var(--sage)' },
    Broken:    { bg: 'rgba(181,72,61,.18)',  fg: 'var(--rust)' },
    Cancelled: { bg: 'rgba(100,116,139,.18)',fg: 'var(--t-2)' },
  };
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {(['Open','Broken','Kept','Cancelled'] as const).map(k => {
        if (counts[k] === 0) return null;
        const s = map[k];
        return (
          <span key={k} style={{
            background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700,
            letterSpacing: '.08em', padding: '3px 7px', borderRadius: 5,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <strong>{counts[k]}</strong> {k}
          </span>
        );
      })}
    </span>
  );
}

// ─── Shared bits ─────────────────────────────────────────────
function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16,
      padding: '12px 16px', background: 'var(--bg-1, #fff)',
      border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, flexWrap: 'wrap',
    }}>{children}</div>
  );
}
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'var(--navy-deep)' : 'transparent',
      color: active ? '#fff' : 'var(--t-2)',
      border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)',
      borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600,
      letterSpacing: '.04em', cursor: 'pointer',
    }}>{children}</button>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, overflow: 'hidden' }}>{children}</div>;
}
function Loading() { return <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>; }
function ErrorBox({ children }: { children: React.ReactNode }) { return <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {children}</div>; }
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}>
      <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>{title}</h3>
      <p style={{ color: 'var(--t-2)' }}>{body}</p>
    </div>
  );
}
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const theadStyle: React.CSSProperties = { background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' };
const trStyle: React.CSSProperties = { cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' };
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return <td style={{ textAlign: align || 'left', padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? "inherit" : undefined }}>{children}</td>;
}
