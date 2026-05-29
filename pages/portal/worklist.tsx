// ============================================================
// /portal/worklist — My Worklist (single-user daily action list).
// ============================================================
// A filter dropdown at the top lets the user pick a "view":
//   • All my accounts          (every account in their scope)
//   • Need follow-up           (nextFu <= today)
//   • Hold candidates          (onHold = 'Candidate')
//   • On hold                  (onHold = 'Active')
//   • 90+ stuck                (d90p > 0, sorted by stuck amount)
//   • Customer credits         (bill < 0 — advances / refunds)
//   • Top 20 outstanding       (bill DESC, capped at 20)
//
// The /api/accounts endpoint already applies role-based exec
// visibility, so this view automatically scopes to "my book" for
// exec/cm roles, and shows everything for owner/admin.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { AccountSearch } from '../../components/AccountSearch';
import { TierBadge } from '../../components/TierBadge';
import { SendReminder } from '../../components/SendReminder';
import { ExportButton } from '../../components/ExportButton';
import { fmtINR } from '../../lib/fmt';

type View = 'all' | 'followup' | 'candidates' | 'active-holds' | 'stuck90' | 'credits' | 'top20';

const VIEWS: Array<{ key: View; label: string; hint: string }> = [
  { key: 'all',          label: 'All my accounts',  hint: 'Every account in your scope' },
  { key: 'followup',     label: 'Need follow-up',   hint: 'Accounts whose next-followup date has passed' },
  { key: 'candidates',   label: 'Hold candidates',  hint: 'Flagged for hold, awaiting owner approval' },
  { key: 'active-holds', label: 'On hold',          hint: 'Bookings currently blocked for these parties' },
  { key: 'stuck90',      label: '90+ stuck',        hint: 'Accounts with money stuck > 90 days' },
  { key: 'credits',      label: 'Customer credits', hint: 'Customers in credit — refunds / advances' },
  { key: 'top20',        label: 'Top 20 outstanding', hint: 'Biggest exposure right now' },
];

type AccountRow = {
  id: string; party: string; family: string | null;
  exec: string | null; cm: string | null; tier: string;
  alert: string | null; onHold: string | null; stage: string | null;
  bill: number; d30: number; d60: number; d90: number; d90p: number;
  nextFu: string | null; lastTouched: string | null;
};

export default function WorklistPage() {
  return (
    <AppShell title="My Worklist" crumb="My Worklist">
      <Inner />
    </AppShell>
  );
}

type SortKey = 'family' | 'bill' | 'd90p' | 'party' | 'nextFu' | 'tier';
type SortDir = 'asc' | 'desc';

function Inner() {
  const [view, setView] = useState<View>('all');
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Default sort = by family (alphabetical) so accounts in the
  // same family group together. Click any other column to switch.
  const [sortKey, setSortKey] = useState<SortKey>('family');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Load every row in the user's scope once (≤500 for any reasonable team).
  // Filtering happens client-side so changing the view is instant.
  useEffect(() => {
    setLoading(true); setError(null);
    fetch('/api/accounts?limit=500')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows((r.data.accounts || []).map((a: any) => ({
          ...a,
          bill: Number(a.bill || 0),
          d30: Number(a.d30 || 0), d60: Number(a.d60 || 0),
          d90: Number(a.d90 || 0), d90p: Number(a.d90p || 0),
        })));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const arr = filterRows(rows, view);
    arr.sort((a, b) => {
      let av: any; let bv: any;
      switch (sortKey) {
        case 'family':  av = (a.family || 'zzz').toLowerCase();
                        bv = (b.family || 'zzz').toLowerCase(); break;
        case 'bill':    av = a.bill;   bv = b.bill;   break;
        case 'd90p':    av = a.d90p;   bv = b.d90p;   break;
        case 'party':   av = a.party.toLowerCase(); bv = b.party.toLowerCase(); break;
        case 'nextFu':  av = a.nextFu ? +new Date(a.nextFu) : Infinity;
                        bv = b.nextFu ? +new Date(b.nextFu) : Infinity; break;
        case 'tier':    av = a.tier; bv = b.tier; break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      // Family ties → secondary sort by outstanding DESC so the
      // biggest account in a family floats to the top of its group
      if (sortKey === 'family') return b.bill - a.bill;
      return 0;
    });
    return arr;
  }, [rows, view, sortKey, sortDir]);
  const meta = VIEWS.find(v => v.key === view)!;

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'party' || key === 'tier' || key === 'nextFu' || key === 'family' ? 'asc' : 'desc'); }
  }

  // When sorting by family, build a list of {family, total, count}
  // pre-totals so we can render a sticky sub-header before each group.
  const familyGrouped = sortKey === 'family';
  const familyTotals = useMemo(() => {
    if (!familyGrouped) return null;
    const m = new Map<string, { count: number; total: number; d90p: number }>();
    for (const r of filtered) {
      const k = r.family || '(no family)';
      const cur = m.get(k) || { count: 0, total: 0, d90p: 0 };
      cur.count += 1;
      cur.total += r.bill;
      cur.d90p += r.d90p;
      m.set(k, cur);
    }
    return m;
  }, [familyGrouped, filtered]);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '4px 4px 60px' }}>
      <AccountSearch onSelect={setOpenId} />
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>My Worklist</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.5 }}>
          Daily action list — pick a view to focus on what needs your attention.
        </p>
      </div>

      <div style={{
        display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 18,
      }}>
        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
          View
        </label>
        <select
          value={view}
          onChange={e => setView(e.target.value as View)}
          style={{
            minWidth: 260, padding: '10px 14px', borderRadius: 8,
            border: '1px solid rgba(15,40,85,0.18)', background: '#fff',
            fontSize: 13.5, fontWeight: 600, color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          {VIEWS.map(v => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{meta.hint}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            {loading ? 'Loading…' : `${filtered.length} account${filtered.length === 1 ? '' : 's'}`}
          </span>
          <ExportButton
            fileName={`worklist-${view}`}
            rows={filtered}
            columns={[
              { header: 'Tier',         get: r => r.tier },
              { header: 'Party',        get: r => r.party },
              { header: 'Family',       get: r => r.family || '' },
              { header: 'Exec',         get: r => r.exec   || '' },
              { header: 'CM',           get: r => r.cm     || '' },
              { header: 'Outstanding',  get: r => r.bill, numeric: true },
              { header: '0-30',         get: r => r.d30,  numeric: true },
              { header: '31-60',        get: r => r.d60,  numeric: true },
              { header: '61-90',        get: r => r.d90,  numeric: true },
              { header: '90+',          get: r => r.d90p, numeric: true },
              { header: 'Hold',         get: r => r.onHold || '' },
              { header: 'Next Followup',get: r => r.nextFu ? new Date(r.nextFu).toLocaleDateString('en-IN') : '' },
            ]}
          />
        </span>
      </div>

      {error && <div style={{ color: 'var(--rust)', padding: 16 }}>Failed: {error}</div>}

      {!loading && filtered.length === 0 && (
        <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}>
          <h3 style={{ fontSize: 17, color: 'var(--ink)', margin: 0 }}>Nothing here</h3>
          <p style={{ color: 'var(--ink-soft)', marginTop: 8 }}>
            No accounts match "{meta.label}" right now. Try a different view from the dropdown.
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{
          background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(15,40,85,0.10)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(15,40,85,0.04)', borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
                <SortableTh field="tier"   active={sortKey === 'tier'}   dir={sortDir} onSort={toggleSort}>Tier</SortableTh>
                <SortableTh field="party"  active={sortKey === 'party'}  dir={sortDir} onSort={toggleSort}>Party</SortableTh>
                <SortableTh field="family" active={sortKey === 'family'} dir={sortDir} onSort={toggleSort}>Family</SortableTh>
                <SortableTh field="bill"   active={sortKey === 'bill'}   dir={sortDir} onSort={toggleSort} align="right">Outstanding</SortableTh>
                <SortableTh field="d90p"   active={sortKey === 'd90p'}   dir={sortDir} onSort={toggleSort} align="right">90+ stuck</SortableTh>
                <Th>Hold</Th>
                <SortableTh field="nextFu" active={sortKey === 'nextFu'} dir={sortDir} onSort={toggleSort}>Next FU</SortableTh>
                <Th align="right" width="100">Action</Th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // When sorted by family, insert a tinted sub-header row before
                // each new family group. Adds a nice grouping cue without
                // changing the table structure.
                let lastFam: string | null | undefined;
                const out: React.ReactNode[] = [];
                filtered.forEach(r => {
                  if (familyGrouped) {
                    const fam = r.family || '(no family)';
                    if (fam !== lastFam) {
                      const t = familyTotals?.get(fam);
                      out.push(
                        <tr key={`fam-${fam}`} style={{ background: 'rgba(15,40,85,0.06)' }}>
                          <td colSpan={8} style={{ padding: '8px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                              <span style={{
                                fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase',
                                fontWeight: 700, color: 'var(--ink, #0F2855)',
                              }}>{fam}</span>
                              {t && (
                                <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                                  {t.count} account{t.count === 1 ? '' : 's'} · {fmtINR(t.total)}
                                  {t.d90p > 0 && <> · <span style={{ color: 'var(--rust, #B5483D)', fontWeight: 600 }}>{fmtINR(t.d90p)} stuck 90+</span></>}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                      lastFam = fam;
                    }
                  }
                  out.push(
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid rgba(15,40,85,0.06)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(15,40,85,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Td><TierBadge tier={r.tier} /></Td>
                      <Td><strong style={{ color: 'var(--ink)' }}>{r.party}</strong></Td>
                      <Td>{r.family || '—'}</Td>
                      <Td align="right" mono color={r.bill < 0 ? 'var(--sage)' : undefined}>{fmtINR(r.bill)}</Td>
                      <Td align="right" mono color={r.d90p > 0 ? 'var(--rust)' : 'var(--ink-soft)'}>
                        {r.d90p > 0 ? fmtINR(r.d90p) : '—'}
                      </Td>
                      <Td><HoldPill status={r.onHold} /></Td>
                      <Td>{r.nextFu ? new Date(r.nextFu).toLocaleDateString('en-IN') : '—'}</Td>
                      <Td align="right">
                        <span onClick={e => e.stopPropagation()}>
                          <SendReminder
                            party={r.party}
                            outstanding={r.bill}
                            daysOverdue={r.nextFu ? Math.max(0, Math.floor((Date.now() - +new Date(r.nextFu)) / 86400000)) : undefined}
                            execName={r.exec || undefined}
                            variant="icon"
                          />
                        </span>
                      </Td>
                    </tr>
                  );
                });
                return out;
              })()}
            </tbody>
          </table>
        </div>
      )}

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function filterRows(rows: AccountRow[], view: View): AccountRow[] {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  switch (view) {
    case 'followup':
      return rows
        .filter(r => r.nextFu && new Date(r.nextFu) <= today && r.bill > 0)
        .sort((a, b) => +new Date(a.nextFu!) - +new Date(b.nextFu!));
    case 'candidates':
      return rows.filter(r => r.onHold === 'Candidate').sort((a, b) => b.bill - a.bill);
    case 'active-holds':
      return rows.filter(r => r.onHold === 'Active').sort((a, b) => b.bill - a.bill);
    case 'stuck90':
      return rows.filter(r => r.d90p > 0).sort((a, b) => b.d90p - a.d90p);
    case 'credits':
      return rows.filter(r => r.bill < 0).sort((a, b) => a.bill - b.bill);
    case 'top20':
      return [...rows].filter(r => r.bill > 0).sort((a, b) => b.bill - a.bill).slice(0, 20);
    case 'all':
    default:
      return [...rows].sort((a, b) => b.bill - a.bill);
  }
}

// ─── Presentational bits ──────────────────────────────────────
function Th({ children, align, width }: { children: React.ReactNode; align?: 'left' | 'right'; width?: string }) {
  return (
    <th style={{
      textAlign: align || 'left', width,
      padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700,
    }}>{children}</th>
  );
}
function SortableTh({
  children, field, active, dir, onSort, align,
}: {
  children: React.ReactNode; field: SortKey;
  active: boolean; dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  return (
    <th style={{
      textAlign: align || 'left',
      padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: active ? 'var(--ink, #0F2855)' : 'var(--ink-soft)',
      fontWeight: 700, cursor: 'pointer', userSelect: 'none',
    }} onClick={() => onSort(field)}>
      {children}{' '}
      <span style={{ fontSize: 9, opacity: active ? 1 : 0.3 }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );
}
function Td({ children, align, mono, color }: {
  children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean; color?: string;
}) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '12px 14px',
      color: color || 'var(--ink)',
      verticalAlign: 'middle',
      fontFamily: mono ? 'inherit' : undefined,
      fontVariantNumeric: mono ? 'tabular-nums' : undefined,
      fontWeight: mono ? 600 : undefined,
    }}>{children}</td>
  );
}
function HoldPill({ status }: { status: string | null }) {
  if (!status) return <span style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 600 }}>—</span>;
  const map: Record<string, { bg: string; fg: string }> = {
    Active:    { bg: 'rgba(178,79,55,.16)',  fg: 'var(--rust)' },
    Candidate: { bg: 'rgba(217,165,69,.18)', fg: 'var(--amber, #B58430)' },
  };
  const s = map[status] || { bg: 'rgba(120,130,150,.18)', fg: 'var(--ink-soft)' };
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700,
      letterSpacing: '.12em', textTransform: 'uppercase',
      padding: '4px 8px', borderRadius: 6,
    }}>{status}</span>
  );
}
