// ============================================================
// /portal/collections — Collection List.
// ============================================================
// Recent payment events with date-window selector + total at top.
// Click party → AccountDrawer.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { AccountSearch } from '../../components/AccountSearch';
import { TierBadge } from '../../components/TierBadge';
import { SortableTh, useSort } from '../../components/SortableTh';
import { fmtINR, fmtDate } from '../../lib/fmt';

type SortKey = 'date' | 'tier' | 'party' | 'family' | 'amount' | 'newOut' | 'exec' | 'trigger';

type Row = {
  id: string; date: string; party: string; family: string | null;
  exec: string | null; cm: string | null;
  amount: string | number;
  prevOutstanding: string | number; newOutstanding: string | number;
  trigger: string | null; notes: string | null;
  account_id: string | null; tier: string | null;
};

const WINDOWS = [
  { key: 7,   label: '7 days' },
  { key: 30,  label: '30 days' },
  { key: 90,  label: '90 days' },
  { key: 365, label: '12 months' },
];

export default function CollectionListPage() {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const sortCtl = useSort<Row, SortKey>('date', 'desc', {
    date:    r => +new Date(r.date),
    tier:    r => r.tier || '',
    party:   r => r.party.toLowerCase(),
    family:  r => (r.family || '').toLowerCase(),
    amount:  r => Number(r.amount),
    newOut:  r => Number(r.newOutstanding),
    exec:    r => (r.exec || '').toLowerCase(),
    trigger: r => (r.trigger || '').toLowerCase(),
  });

  useEffect(() => {
    setRows(null); setError(null);
    fetch(`/api/collections?days=${days}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.collections || []);
        setTotal(r.data.totalAmount || 0);
      })
      .catch(e => setError(e.message));
  }, [days]);

  return (
    <AppShell title="Collection List" crumb="Collection List">
      <AccountSearch onSelect={setOpenId} />
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, marginBottom: 16, padding: '14px 18px',
        background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {WINDOWS.map(w => (
            <FilterChip key={w.key} active={days === w.key} onClick={() => setDays(w.key)}>{w.label}</FilterChip>
          ))}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>Recovered</div>
          <div style={{ fontFamily: "inherit", fontSize: 20, color: 'var(--sage)', fontWeight: 600 }}>{fmtINR(total)}</div>
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {rows === null && !error && <Loading />}
      {rows && rows.length === 0 && <EmptyState
        title="No collections in this window"
        body="Payment events appear here automatically when accounts' outstanding drops between refreshes (or via manual mark-paid)." />}

      {rows && rows.length > 0 && (
        <Card>
          <table style={tableStyle}>
            <thead>
              <tr style={theadStyle}>
                <SortableTh field="date"    active={sortCtl.key === 'date'}    dir={sortCtl.dir} onSort={sortCtl.toggle}>Date</SortableTh>
                <SortableTh field="tier"    active={sortCtl.key === 'tier'}    dir={sortCtl.dir} onSort={sortCtl.toggle}>Tier</SortableTh>
                <SortableTh field="party"   active={sortCtl.key === 'party'}   dir={sortCtl.dir} onSort={sortCtl.toggle}>Party</SortableTh>
                <SortableTh field="family"  active={sortCtl.key === 'family'}  dir={sortCtl.dir} onSort={sortCtl.toggle}>Family</SortableTh>
                <SortableTh field="amount"  active={sortCtl.key === 'amount'}  dir={sortCtl.dir} onSort={sortCtl.toggle} align="right">Amount</SortableTh>
                <SortableTh field="newOut"  active={sortCtl.key === 'newOut'}  dir={sortCtl.dir} onSort={sortCtl.toggle} align="right">Prev → New</SortableTh>
                <SortableTh field="exec"    active={sortCtl.key === 'exec'}    dir={sortCtl.dir} onSort={sortCtl.toggle}>Exec</SortableTh>
                <SortableTh field="trigger" active={sortCtl.key === 'trigger'} dir={sortCtl.dir} onSort={sortCtl.toggle}>Trigger</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortCtl.sort(rows).map(r => (
                <tr key={r.id} onClick={() => r.account_id && setOpenId(r.account_id)}
                    style={trStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Td>{fmtDate(r.date)}</Td>
                  <Td>{r.tier ? <TierBadge tier={r.tier} /> : '—'}</Td>
                  <Td><strong style={{ color: 'var(--navy-deep)' }}>{r.party}</strong></Td>
                  <Td>{r.family || '—'}</Td>
                  <Td align="right" mono><strong style={{ color: 'var(--sage)' }}>↓ {fmtINR(Number(r.amount))}</strong></Td>
                  <Td align="right" mono style={{ fontSize: 11, color: 'var(--t-3)' }}>
                    {fmtINR(Number(r.prevOutstanding))} → {fmtINR(Number(r.newOutstanding))}
                  </Td>
                  <Td>{r.exec || '—'}</Td>
                  <Td><span style={{ fontSize: 11, color: 'var(--t-3)' }}>{r.trigger || '—'}</span></Td>
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

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} style={{ background: active ? 'var(--navy-deep)' : 'transparent', color: active ? '#fff' : 'var(--t-2)', border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', cursor: 'pointer' }}>{children}</button>; }
function Card({ children }: { children: React.ReactNode }) { return <div style={{ background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, overflow: 'hidden' }}>{children}</div>; }
function Loading() { return <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>; }
function ErrorBox({ children }: { children: React.ReactNode }) { return <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {children}</div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}><h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>{title}</h3><p style={{ color: 'var(--t-2)' }}>{body}</p></div>; }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const theadStyle: React.CSSProperties = { background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' };
const trStyle: React.CSSProperties = { cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' };
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) { return <th style={{ textAlign: align || 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>; }
function Td({ children, align, mono, style }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean; style?: React.CSSProperties }) { return <td style={{ textAlign: align || 'left', padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? "inherit" : undefined, ...style }}>{children}</td>; }
