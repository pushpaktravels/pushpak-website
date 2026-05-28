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
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR } from '../../lib/fmt';

type FamilyRow = {
  family: string;
  accountCount: number;
  totalOutstanding: number;
  activeHolds: number;
  candidates: number;
  topTier: string | null;
  hasVip: boolean;
  owingUnconverted: number;
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
  const [convertingFamily, setConvertingFamily] = useState<string | null>(null);
  const [convertResult, setConvertResult] = useState<{ family: string; created: number } | null>(null);
  // Track families whose accounts have all been converted so the
  // "Convert to Legal" button can hide. We refresh this set after
  // every successful conversion.
  const [doneFamilies, setDoneFamilies] = useState<Set<string>>(new Set());
  const confirm = useConfirm();

  function reload() {
    fetch('/api/families')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setFamilies(r.data.families || []);
      })
      .catch(e => setError(e.message));
  }
  useEffect(() => { reload(); }, []);

  async function convertFamilyToLegal(family: string) {
    const ok = await confirm({
      title: `Convert ${family} to legal cases?`,
      body: `Create Filed legal cases for every owing account in "${family}". Accounts that already have an open legal case will be skipped automatically.`,
      confirmLabel: 'Convert',
    });
    if (!ok) return;
    setConvertingFamily(family); setError(null);
    try {
      const r = await fetch('/api/legal/bulk-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Conversion failed');
      setConvertResult({ family, created: r.created });
      // Mark the family as done so the button disappears.
      setDoneFamilies(prev => {
        const next = new Set(prev);
        next.add(family);
        return next;
      });
      // Refresh the families list so owingUnconverted updates and
      // the converted ✓ pill replaces the button.
      reload();
      // Reload accounts list if this family is currently expanded
      if (expanded === family) {
        setExpanded(null);
        setTimeout(() => setExpanded(family), 50);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConvertingFamily(null);
    }
  }

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

      {convertResult && (
        <div style={{
          padding: '12px 16px', marginBottom: 14, borderRadius: 10,
          background: 'rgba(46,108,84,0.10)', border: '1px solid rgba(46,108,84,0.32)',
          color: 'var(--ink)', fontSize: 13,
        }}>
          ✓ {convertResult.created} account{convertResult.created === 1 ? '' : 's'} from <b>{convertResult.family}</b> now have Filed legal cases. View them in the Legal Ledger.
          <button onClick={() => setConvertResult(null)}
            style={{ background:'transparent', border:'none', color: 'var(--ink-soft)', cursor:'pointer', marginLeft: 12, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase' }}>Dismiss</button>
        </div>
      )}

      {families && families.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {families.map(f => {
            const isOpen = expanded === f.family;
            const isLegalFamily = /^legal[\s\-]/i.test(f.family);
            return (
              <div key={f.family} style={{
                background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
                borderRadius: 12, overflow: 'hidden',
              }}>
                <div
                  role="button" tabIndex={0}
                  onClick={() => setExpanded(isOpen ? null : f.family)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(isOpen ? null : f.family); } }}
                  style={{
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
                  {isLegalFamily && !doneFamilies.has(f.family) && f.owingUnconverted > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); convertFamilyToLegal(f.family); }}
                      disabled={convertingFamily === f.family}
                      title={`Create Filed legal cases for every owing account in ${f.family}`}
                      style={{
                        marginLeft: 12, padding: '8px 14px', borderRadius: 8,
                        background: 'rgba(178,79,55,.10)', border: '1px solid rgba(178,79,55,.4)',
                        color: 'var(--rust)', fontSize: 10.5, fontWeight: 700,
                        letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        opacity: convertingFamily === f.family ? 0.5 : 1,
                      }}
                    >
                      {convertingFamily === f.family ? 'Converting…' : 'Convert to Legal'}
                    </button>
                  )}
                  {isLegalFamily && (doneFamilies.has(f.family) || f.owingUnconverted === 0) && (
                    <span style={{
                      marginLeft: 12, padding: '6px 12px', borderRadius: 6,
                      background: 'rgba(46,108,84,0.10)',
                      color: 'var(--sage, #2E6C54)',
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '.18em', textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}>✓ Converted</span>
                  )}
                </div>

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
                            <tr key={a.id}
                                style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <Td>
                                <TierSelect
                                  accountId={a.id}
                                  current={a.tier}
                                  onSaved={(newTier) => {
                                    setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, tier: newTier } : x));
                                  }}
                                />
                              </Td>
                              <Td>
                                <button onClick={() => setOpenId(a.id)} style={{
                                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                                  fontWeight: 600, color: 'var(--navy-deep)', textAlign: 'left',
                                  fontFamily: 'inherit', fontSize: 12,
                                }}>{a.party}</button>
                              </Td>
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

// ─── Inline tier-change dropdown ───────────────────────────────
// Replaces the read-only TierBadge with an editable select. The
// API treats manual tier changes as overrides automatically.
function TierSelect({
  accountId, current, onSaved,
}: { accountId: string; current: string; onSaved: (t: string) => void }) {
  const [val, setVal] = useState(current);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: string) {
    if (next === val) return;
    const old = val;
    setVal(next); setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: next }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      onSaved(next);
    } catch (e: any) {
      setVal(old);
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const palette: Record<string, { bg: string; fg: string }> = {
    A: { bg: 'rgba(46,108,84,0.14)',  fg: 'var(--sage, #2E6C54)' },
    B: { bg: 'rgba(46,108,84,0.10)',  fg: 'var(--sage, #2E6C54)' },
    C: { bg: 'rgba(217,165,69,0.20)', fg: 'var(--amber, #B58430)' },
    D: { bg: 'rgba(217,165,69,0.20)', fg: 'var(--amber, #B58430)' },
    E: { bg: 'rgba(178,79,55,0.16)',  fg: 'var(--rust, #B5483D)' },
  };
  const p = palette[val] || palette.A;

  return (
    <select
      value={val}
      disabled={saving}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => save(e.target.value)}
      title={err || `Change tier (currently ${val})`}
      style={{
        background: p.bg, color: p.fg,
        border: 'none', borderRadius: 6,
        padding: '4px 8px', fontSize: 11, fontWeight: 700,
        letterSpacing: '.16em', textTransform: 'uppercase',
        cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit',
        opacity: saving ? 0.6 : 1,
      }}
    >
      {['A','B','C','D','E'].map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
