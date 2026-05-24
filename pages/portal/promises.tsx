// ============================================================
// /portal/promises — Promise Ledger.
// ============================================================
// All promises across visible accounts. Status filter at top.
// Open (especially overdue) float to the top.
// Click row → AccountDrawer.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR, fmtDate } from '../../lib/fmt';

type Row = {
  id: string;
  party: string;
  family: string | null;
  expectedBy: string;
  exec: string | null;
  outstandingAt: string | number;
  status: 'Open' | 'Kept' | 'Broken' | 'Cancelled';
  amountReceived: string | number;
  settledOn: string | null;
  notes: string | null;
  account_id: string | null;
  tier: string | null;
  hold: string | null;
  days_overdue: number | null;
};

const STATUSES: Array<'all' | 'Open' | 'Kept' | 'Broken' | 'Cancelled'> = ['all', 'Open', 'Kept', 'Broken', 'Cancelled'];

export default function PromiseLedgerPage() {
  const [status, setStatus] = useState<typeof STATUSES[number]>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
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

  return (
    <AppShell title="Promise Ledger" crumb="Promise Ledger">
      <FilterBar>
        {STATUSES.map(s => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
            {s === 'all' ? 'All' : s}
          </FilterChip>
        ))}
      </FilterBar>

      {error && <ErrorBox>{error}</ErrorBox>}
      {rows === null && !error && <Loading />}
      {rows && rows.length === 0 && <EmptyState
        title={status === 'all' ? 'No promises yet' : `No ${status.toLowerCase()} promises`}
        body="Promises appear here as they are added from the Account Drawer." />}

      {rows && rows.length > 0 && (
        <Card>
          <table style={tableStyle}>
            <thead>
              <tr style={theadStyle}>
                <Th>Tier</Th>
                <Th>Party</Th>
                <Th>Family</Th>
                <Th>Expected By</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Exec</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}
                    onClick={() => r.account_id && setOpenId(r.account_id)}
                    style={trStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Td>{r.tier ? <TierBadge tier={r.tier} /> : '—'}</Td>
                  <Td><strong style={{ color: 'var(--navy-deep)' }}>{r.party}</strong></Td>
                  <Td>{r.family || '—'}</Td>
                  <Td>
                    {fmtDate(r.expectedBy)}
                    {r.days_overdue && r.days_overdue > 0 && (
                      <span style={{ marginLeft: 8, color: 'var(--rust)', fontSize: 11, fontWeight: 600 }}>
                        ↑ {r.days_overdue}d overdue
                      </span>
                    )}
                  </Td>
                  <Td align="right" mono>{fmtINR(Number(r.outstandingAt))}</Td>
                  <Td><PromiseStatusPill status={r.status} /></Td>
                  <Td>{r.exec || '—'}</Td>
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

// ─── Shared bits (kept inline per-page for now; will extract if a 3rd page reuses) ─
function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 8, marginBottom: 16, padding: '12px 16px',
      background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
      borderRadius: 12, flexWrap: 'wrap',
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
  return (
    <div style={{
      background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
      borderRadius: 12, overflow: 'hidden',
    }}>{children}</div>
  );
}

function Loading() { return <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>; }
function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {children}</div>;
}
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
  return <td style={{ textAlign: align || 'left', padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? "'JetBrains Mono', monospace" : undefined }}>{children}</td>;
}

function PromiseStatusPill({ status }: { status: Row['status'] }) {
  const map = {
    Open:      { bg: 'rgba(217,165,69,.18)',  fg: 'var(--amber)' },
    Kept:      { bg: 'rgba(83,127,107,.18)',  fg: 'var(--sage)' },
    Broken:    { bg: 'rgba(178,79,55,.18)',   fg: 'var(--rust)' },
    Cancelled: { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' },
  };
  const s = map[status];
  return <span style={{ background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 6 }}>{status}</span>;
}
