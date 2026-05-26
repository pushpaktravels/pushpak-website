// ============================================================
// /portal/families — Clients & Families summary.
// ============================================================
// Owner/admin only. Aggregates Account rows by family with
// outstanding totals + hold counts. Click family → expands a list
// of accounts in that family. Click account → AccountDrawer.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR } from '../../lib/fmt';

type FamilyRow = {
  family: string;
  accountCount: number;
  totalOutstanding: number;
  activeHolds: number;
  candidates: number;
  topTier: string | null;
  hasVip: boolean;
};

type AccountRow = {
  id: string; party: string; family: string | null;
  exec: string | null; tier: string;
  bill: string | number; onHold: string | null; alert: string | null;
};

export default function FamiliesPage() {
  const [families, setFamilies] = useState<FamilyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accLoading, setAccLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/families')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setFamilies(r.data.families || []);
      })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!expanded) { setAccounts([]); return; }
    setAccLoading(true);
    // Reuse /api/accounts with no exec filter — family filtering done client-side
    // (the /api/accounts endpoint doesn't have a family filter yet; do it here)
    fetch(`/api/accounts?limit=500`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        const allAccs = (r.data.accounts || []) as AccountRow[];
        const filtered = expanded === '(no family)'
          ? allAccs.filter(a => !a.family)
          : allAccs.filter(a => (a.family || '') === expanded);
        setAccounts(filtered);
      })
      .catch(e => setError(e.message))
      .finally(() => setAccLoading(false));
  }, [expanded]);

  return (
    <AppShell title="Clients & Families" crumb="Clients & Families">
      {error && <ErrorBox>{error}</ErrorBox>}
      {families === null && !error && <Loading />}
      {families && families.length === 0 && <EmptyState
        title="No families yet"
        body="Once accounts are uploaded with family attribution, the aggregated view appears here." />}

      {families && families.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {families.map(f => {
            const isOpen = expanded === f.family;
            return (
              <div key={f.family} style={{
                background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
                borderRadius: 12, overflow: 'hidden',
              }}>
                <button onClick={() => setExpanded(isOpen ? null : f.family)} style={{
                  width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                  cursor: 'pointer', padding: 18, display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <span style={{
                    color: 'var(--t-2)', fontSize: 18,
                    transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform .12s ease',
                  }}>›</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: 'var(--navy-deep)', fontSize: 15 }}>{f.family}</span>
                      {f.topTier && <TierBadge tier={f.topTier} />}
                      {f.hasVip && <span style={{ background: 'rgba(217,165,69,.18)', color: 'var(--amber)', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 6 }}>VIP</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
                      {f.accountCount} account{f.accountCount === 1 ? '' : 's'}
                      {f.activeHolds > 0 && <span style={{ marginLeft: 8, color: 'var(--rust)' }}>· {f.activeHolds} active hold{f.activeHolds === 1 ? '' : 's'}</span>}
                      {f.candidates > 0 && <span style={{ marginLeft: 8, color: 'var(--amber)' }}>· {f.candidates} candidate{f.candidates === 1 ? '' : 's'}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: "inherit", fontSize: 16, fontWeight: 600, color: 'var(--navy-deep)' }}>{fmtINR(f.totalOutstanding)}</div>
                    <div style={{ fontSize: 10, color: 'var(--t-3)', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600, marginTop: 2 }}>Outstanding</div>
                  </div>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--line, #e7eaf0)' }}>
                    {accLoading && <div style={{ padding: 18, color: 'var(--t-3)', fontSize: 13 }}>Loading accounts…</div>}
                    {!accLoading && accounts.length === 0 && <div style={{ padding: 18, color: 'var(--t-3)', fontSize: 13 }}>No accounts.</div>}
                    {!accLoading && accounts.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-2, #f6f8fb)' }}>
                            <Th>Tier</Th><Th>Party</Th><Th align="right">Outstanding</Th>
                            <Th>Hold</Th><Th>Alert</Th><Th>Exec</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.map(a => (
                            <tr key={a.id} onClick={() => setOpenId(a.id)}
                                style={{ cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <Td><TierBadge tier={a.tier} /></Td>
                              <Td><strong style={{ color: 'var(--navy-deep)' }}>{a.party}</strong></Td>
                              <Td align="right" mono>{fmtINR(Number(a.bill))}</Td>
                              <Td>{a.onHold ? <span style={{ color: a.onHold === 'Active' ? 'var(--rust)' : 'var(--amber)', fontSize: 11, fontWeight: 600 }}>{a.onHold}</span> : <span style={{ color: 'var(--sage)', fontSize: 11 }}>Clear</span>}</Td>
                              <Td>{a.alert || '—'}</Td>
                              <Td>{a.exec || '—'}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
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

function Loading() { return <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>; }
function ErrorBox({ children }: { children: React.ReactNode }) { return <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {children}</div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}><h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>{title}</h3><p style={{ color: 'var(--t-2)' }}>{body}</p></div>; }
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) { return <th style={{ textAlign: align || 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>; }
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) { return <td style={{ textAlign: align || 'left', padding: '10px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? "inherit" : undefined }}>{children}</td>; }
