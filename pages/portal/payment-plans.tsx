// ============================================================
// /portal/payment-plans — Doubtful Ledger.
// ============================================================
// Each row = one payment plan. Click chevron → expand instalment
// schedule. Click party name → AccountDrawer.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { AccountSearch } from '../../components/AccountSearch';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR, fmtDate } from '../../lib/fmt';

type Instalment = {
  id: string; instNo: number; dueDate: string;
  amount: string | number; status: string;
  received: string | number; settledOn: string | null;
};
type Plan = {
  id: string; party: string; family: string | null;
  planTotal: string | number;
  startDate: string;
  cancelledAt: string | null;
  account_id: string | null;
  exec: string | null;
  tier: string | null;
  current_outstanding: string | number;
  instalments: Instalment[];
  totalReceived: number;
  pendingCount: number;
  brokenCount: number;
};

export default function DoubtfulLedgerPage() {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setPlans(null); setError(null);
    fetch(`/api/payment-plans?scope=${scope}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setPlans(r.data.plans || []);
      })
      .catch(e => setError(e.message));
  }, [scope]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <AppShell title="Doubtful Ledger" crumb="Doubtful Ledger">
      <AccountSearch onSelect={setOpenId} />
      <FilterBar>
        <FilterChip active={scope === 'active'} onClick={() => setScope('active')}>Active</FilterChip>
        <FilterChip active={scope === 'all'} onClick={() => setScope('all')}>All (incl. cancelled)</FilterChip>
      </FilterBar>

      {error && <ErrorBox>{error}</ErrorBox>}
      {plans === null && !error && <Loading />}
      {plans && plans.length === 0 && <EmptyState
        title="No payment plans"
        body="Doubtful-tier accounts on a structured payment plan appear here." />}

      {plans && plans.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {plans.map(p => {
            const progressPct = Math.min(100, Math.round(Number(p.totalReceived) / Number(p.planTotal) * 100));
            const isOpen = expanded.has(p.id);
            return (
              <div key={p.id} style={{
                background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
                borderRadius: 12, overflow: 'hidden',
              }}>
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button onClick={() => toggle(p.id)} aria-label="Expand" style={{
                    border: '1px solid var(--line, #e7eaf0)', background: 'transparent',
                    cursor: 'pointer', borderRadius: 6, width: 28, height: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--t-2)', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform .12s ease',
                  }}>›</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      {p.tier && <TierBadge tier={p.tier} />}
                      <button onClick={() => p.account_id && setOpenId(p.account_id)} style={{
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                        color: 'var(--navy-deep)', fontWeight: 600, fontSize: 14,
                      }}>{p.party}</button>
                      {p.cancelledAt && (
                        <span style={{ background: 'rgba(178,79,55,.16)', color: 'var(--rust)',
                          fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
                          padding: '3px 8px', borderRadius: 6 }}>Cancelled</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
                      {p.family} · started {fmtDate(p.startDate)} · {p.exec || 'no exec'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 180 }}>
                    <div style={{ fontFamily: "inherit", fontWeight: 600, color: 'var(--navy-deep)', fontSize: 14 }}>
                      {fmtINR(Number(p.totalReceived))} / {fmtINR(Number(p.planTotal))}
                    </div>
                    <div style={{ marginTop: 6, height: 6, background: 'var(--bg-2, #f6f8fb)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${progressPct}%`, height: '100%', background: progressPct >= 100 ? 'var(--sage)' : 'var(--navy-deep)', transition: 'width .2s' }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>
                      {progressPct}% · {p.pendingCount} pending · {p.brokenCount} broken
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--line, #e7eaf0)', padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-2, #f6f8fb)' }}>
                          <Th>#</Th><Th>Due</Th><Th align="right">Amount</Th>
                          <Th align="right">Received</Th><Th>Status</Th><Th>Settled</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.instalments.map(i => (
                          <tr key={i.id} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                            <Td>{i.instNo}</Td>
                            <Td>{fmtDate(i.dueDate)}</Td>
                            <Td align="right" mono>{fmtINR(Number(i.amount))}</Td>
                            <Td align="right" mono>{fmtINR(Number(i.received))}</Td>
                            <Td><InstStatusPill status={i.status} /></Td>
                            <Td>{i.settledOn ? fmtDate(i.settledOn) : '—'}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

// (Reusing the same small helpers from Promise Ledger. Inlined per page for now.)
function FilterBar({ children }: { children: React.ReactNode }) { return <div style={{ display: 'flex', gap: 8, marginBottom: 16, padding: '12px 16px', background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, flexWrap: 'wrap' }}>{children}</div>; }
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} style={{ background: active ? 'var(--navy-deep)' : 'transparent', color: active ? '#fff' : 'var(--t-2)', border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', cursor: 'pointer' }}>{children}</button>; }
function Loading() { return <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>; }
function ErrorBox({ children }: { children: React.ReactNode }) { return <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {children}</div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}><h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>{title}</h3><p style={{ color: 'var(--t-2)' }}>{body}</p></div>; }
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) { return <th style={{ textAlign: align || 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>; }
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) { return <td style={{ textAlign: align || 'left', padding: '10px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? "inherit" : undefined }}>{children}</td>; }

function InstStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    Pending:   { bg: 'rgba(217,165,69,.18)',  fg: 'var(--amber)' },
    Received:  { bg: 'rgba(83,127,107,.18)',  fg: 'var(--sage)' },
    Broken:    { bg: 'rgba(178,79,55,.18)',   fg: 'var(--rust)' },
    Cancelled: { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' },
  };
  const s = map[status] || map.Pending;
  return <span style={{ background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 6 }}>{status}</span>;
}
