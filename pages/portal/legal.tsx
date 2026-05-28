// ============================================================
// /portal/legal — Legal Ledger.
// ============================================================
// All legal cases with status filter (default 'open' = non-terminal).
// Click party → AccountDrawer.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { SortableTh, useSort } from '../../components/SortableTh';
import { fmtINR, fmtDate } from '../../lib/fmt';

type SortKey = 'tier' | 'party' | 'family' | 'filed' | 'outstanding' | 'status' | 'lawyer' | 'hearing';

type Row = {
  id: string; party: string; family: string | null;
  filedOn: string; outstanding: string | number;
  status: string; lawyer: string | null; caseRef: string | null;
  nextHearing: string | null; notes: string | null;
  account_id: string | null;
  exec: string | null;
  tier: string | null;
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'open', label: 'Active' },
  { key: 'NoticeSent', label: 'Notice sent' },
  { key: 'Filed', label: 'Filed' },
  { key: 'InCourt', label: 'In court' },
  { key: 'Settled', label: 'Settled' },
  { key: 'Recovered', label: 'Recovered' },
  { key: 'WrittenOff', label: 'Written off' },
  { key: 'all', label: 'All' },
];

export default function LegalLedgerPage() {
  const [status, setStatus] = useState<string>('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const sortCtl = useSort<Row, SortKey>('outstanding', 'desc', {
    tier:        r => r.tier || '',
    party:       r => r.party.toLowerCase(),
    family:      r => (r.family || '').toLowerCase(),
    filed:       r => +new Date(r.filedOn),
    outstanding: r => Number(r.outstanding),
    status:      r => r.status,
    lawyer:      r => (r.lawyer || '').toLowerCase(),
    hearing:     r => r.nextHearing ? +new Date(r.nextHearing) : 0,
  });

  useEffect(() => {
    setRows(null); setError(null);
    fetch(`/api/legal?status=${status}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.cases || []);
      })
      .catch(e => setError(e.message));
  }, [status]);

  return (
    <AppShell title="Legal Ledger" crumb="Legal Ledger">
      <FilterBar>
        {FILTERS.map(f => (
          <FilterChip key={f.key} active={status === f.key} onClick={() => setStatus(f.key)}>
            {f.label}
          </FilterChip>
        ))}
      </FilterBar>

      {error && <ErrorBox>{error}</ErrorBox>}
      {rows === null && !error && <Loading />}
      {rows && rows.length === 0 && <EmptyState
        title="No legal cases"
        body="Cases appear here once a legal notice or filing is recorded on an account." />}

      {rows && rows.length > 0 && (
        <Card>
          <table style={tableStyle}>
            <thead>
              <tr style={theadStyle}>
                <SortableTh field="tier"        active={sortCtl.key === 'tier'}        dir={sortCtl.dir} onSort={sortCtl.toggle}>Tier</SortableTh>
                <SortableTh field="party"       active={sortCtl.key === 'party'}       dir={sortCtl.dir} onSort={sortCtl.toggle}>Party</SortableTh>
                <SortableTh field="family"      active={sortCtl.key === 'family'}      dir={sortCtl.dir} onSort={sortCtl.toggle}>Family</SortableTh>
                <SortableTh field="filed"       active={sortCtl.key === 'filed'}       dir={sortCtl.dir} onSort={sortCtl.toggle}>Filed</SortableTh>
                <SortableTh field="outstanding" active={sortCtl.key === 'outstanding'} dir={sortCtl.dir} onSort={sortCtl.toggle} align="right">Outstanding</SortableTh>
                <SortableTh field="status"      active={sortCtl.key === 'status'}      dir={sortCtl.dir} onSort={sortCtl.toggle}>Status</SortableTh>
                <SortableTh field="lawyer"      active={sortCtl.key === 'lawyer'}      dir={sortCtl.dir} onSort={sortCtl.toggle}>Lawyer</SortableTh>
                <SortableTh field="hearing"     active={sortCtl.key === 'hearing'}     dir={sortCtl.dir} onSort={sortCtl.toggle}>Next hearing</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortCtl.sort(rows).map(r => (
                <tr key={r.id} onClick={() => r.account_id && setOpenId(r.account_id)}
                    style={trStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Td>{r.tier ? <TierBadge tier={r.tier} /> : '—'}</Td>
                  <Td><strong style={{ color: 'var(--navy-deep)' }}>{r.party}</strong>
                    {r.caseRef && <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>{r.caseRef}</div>}
                  </Td>
                  <Td>{r.family || '—'}</Td>
                  <Td>{fmtDate(r.filedOn)}</Td>
                  <Td align="right" mono>{fmtINR(Number(r.outstanding))}</Td>
                  <Td><LegalStatusPill status={r.status} /></Td>
                  <Td>{r.lawyer || '—'}</Td>
                  <Td>{r.nextHearing ? fmtDate(r.nextHearing) : '—'}</Td>
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

function FilterBar({ children }: { children: React.ReactNode }) { return <div style={{ display: 'flex', gap: 8, marginBottom: 16, padding: '12px 16px', background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, flexWrap: 'wrap' }}>{children}</div>; }
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} style={{ background: active ? 'var(--navy-deep)' : 'transparent', color: active ? '#fff' : 'var(--t-2)', border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', cursor: 'pointer' }}>{children}</button>; }
function Card({ children }: { children: React.ReactNode }) { return <div style={{ background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, overflow: 'hidden' }}>{children}</div>; }
function Loading() { return <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>; }
function ErrorBox({ children }: { children: React.ReactNode }) { return <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {children}</div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}><h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>{title}</h3><p style={{ color: 'var(--t-2)' }}>{body}</p></div>; }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const theadStyle: React.CSSProperties = { background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' };
const trStyle: React.CSSProperties = { cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' };
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) { return <th style={{ textAlign: align || 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>; }
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) { return <td style={{ textAlign: align || 'left', padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? "inherit" : undefined }}>{children}</td>; }

function LegalStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    NoticeSent: { bg: 'rgba(217,165,69,.18)', fg: 'var(--amber)' },
    Filed:      { bg: 'rgba(217,165,69,.18)', fg: 'var(--amber)' },
    InCourt:    { bg: 'rgba(178,79,55,.18)',  fg: 'var(--rust)' },
    Settled:    { bg: 'rgba(83,127,107,.18)', fg: 'var(--sage)' },
    Recovered:  { bg: 'rgba(83,127,107,.18)', fg: 'var(--sage)' },
    Dropped:    { bg: 'rgba(120,130,150,.18)',fg: 'var(--t-2)' },
    WrittenOff: { bg: 'rgba(120,130,150,.18)',fg: 'var(--t-2)' },
  };
  const s = map[status] || { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' };
  return <span style={{ background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 6 }}>{status}</span>;
}
