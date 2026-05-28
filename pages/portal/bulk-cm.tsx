// ============================================================
// /portal/bulk-cm — Bulk Collection Manager assignment.
// ============================================================
// Owner / Admin only. Layout:
//   ▸ Top: pill row of CMs with current load + a "Assign to" dropdown
//   ▸ Filter bar: search by party, filter by family / exec / tier /
//     "no CM yet"
//   ▸ Account table with a checkbox per row + a header checkbox
//   ▸ "Assign N accounts to <CM>" button at the bottom
// Checkboxes + dropdown chosen over drag-and-drop because they
// scale better when you have 100+ accounts to assign at once.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { TierBadge } from '../../components/TierBadge';
import { AccountDrawer } from '../../components/AccountDrawer';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR } from '../../lib/fmt';

type Account = {
  id: string; party: string; family: string | null;
  exec: string | null; cm: string | null;
  tier: string; bill: number; onHold: string | null;
};
type CM = { name: string; role: string };

export default function BulkCmPage() {
  return (
    <AppShell title="Bulk CM Assignment" crumb="Admin · Bulk CM">
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cms, setCms] = useState<CM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [familyFilter, setFamilyFilter] = useState<string>('');
  const [execFilter, setExecFilter] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [noCMOnly, setNoCMOnly] = useState<boolean>(true);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetCM, setTargetCM] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useConfirm();

  async function load() {
    setLoading(true); setError(null);
    try {
      const [accR, cmR] = await Promise.all([
        fetch('/api/accounts?limit=500').then(r => r.json()),
        fetch('/api/cms-list').then(r => r.json()),
      ]);
      if (!accR?.ok) throw new Error(accR?.error || 'Failed to load accounts');
      if (!cmR?.ok)  throw new Error(cmR?.error  || 'Failed to load CMs');
      setAccounts((accR.data.accounts || []).map((a: any) => ({ ...a, bill: Number(a.bill || 0) })));
      setCms(cmR.cms || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Distinct values for filters
  const distinct = useMemo(() => {
    const fams = new Set<string>();
    const execs = new Set<string>();
    for (const a of accounts) {
      if (a.family) fams.add(a.family);
      if (a.exec)   execs.add(a.exec);
    }
    return {
      families: Array.from(fams).sort(),
      execs: Array.from(execs).sort(),
    };
  }, [accounts]);

  // Filtered + sorted
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter(a => {
      if (noCMOnly && a.cm) return false;
      if (familyFilter && a.family !== familyFilter) return false;
      if (execFilter   && a.exec   !== execFilter)   return false;
      if (tierFilter   && a.tier   !== tierFilter)   return false;
      if (q && !a.party.toLowerCase().includes(q) && !(a.family || '').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => b.bill - a.bill);
  }, [accounts, search, familyFilter, execFilter, tierFilter, noCMOnly]);

  // CM load (count + outstanding by CM)
  const cmLoad = useMemo(() => {
    const m = new Map<string, { count: number; bill: number }>();
    for (const a of accounts) {
      if (!a.cm) continue;
      const cur = m.get(a.cm) || { count: 0, bill: 0 };
      cur.count += 1;
      cur.bill += a.bill;
      m.set(a.cm, cur);
    }
    return m;
  }, [accounts]);

  function toggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(a => a.id)));
    }
  }
  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (selected.size === 0 || !targetCM || assigning) return;
    const ok = await confirm({
      title: `Assign ${selected.size} account${selected.size === 1 ? '' : 's'} to ${targetCM}?`,
      body: 'This will set the Collection Manager on every selected account and log a history entry on each.',
      confirmLabel: 'Assign',
    });
    if (!ok) return;
    setAssigning(true); setError(null); setToast(null);
    try {
      const r = await fetch('/api/accounts/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: Array.from(selected), cm: targetCM }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Assignment failed');
      setToast(`✓ ${r.updated} account${r.updated === 1 ? '' : 's'} assigned to ${targetCM}`);
      setSelected(new Set());
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Bulk CM Assignment</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.5, maxWidth: 760 }}>
          Pick filters → select accounts → choose a Collection Manager → click Assign. Manual reassignments are flagged with the override so future Clientwise refreshes don't undo them.
        </p>
      </div>

      {/* CM load row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10, marginBottom: 20,
      }}>
        {cms.map(c => {
          const load = cmLoad.get(c.name) || { count: 0, bill: 0 };
          const isTarget = targetCM === c.name;
          return (
            <button
              key={c.name}
              onClick={() => setTargetCM(c.name)}
              style={{
                textAlign: 'left', cursor: 'pointer',
                background: isTarget ? 'linear-gradient(180deg,#1A3F7E,#0F2855)' : 'rgba(255,255,255,0.65)',
                color: isTarget ? '#fff' : 'var(--ink)',
                border: isTarget ? '1px solid var(--navy-deep, #0F2855)' : '1px solid rgba(15,40,85,0.10)',
                borderRadius: 10, padding: '12px 14px',
              }}
            >
              <div style={{
                fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase',
                color: isTarget ? 'rgba(255,255,255,0.6)' : 'var(--ink-soft)', fontWeight: 700, marginBottom: 4,
              }}>{c.role.toUpperCase()}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: isTarget ? 'rgba(255,255,255,0.7)' : 'var(--ink-soft)' }}>
                {load.count} account{load.count === 1 ? '' : 's'} · {fmtINR(load.bill)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10, marginBottom: 14,
      }}>
        <input
          type="search" placeholder="Search party or family…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={inputStyle}
        />
        <select value={familyFilter} onChange={e => setFamilyFilter(e.target.value)} style={inputStyle}>
          <option value="">All families</option>
          {distinct.families.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={execFilter} onChange={e => setExecFilter(e.target.value)} style={inputStyle}>
          <option value="">All execs</option>
          {distinct.execs.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} style={inputStyle}>
          <option value="">All tiers</option>
          {['A','B','C','D','E'].map(t => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink)' }}>
          <input type="checkbox" checked={noCMOnly} onChange={e => setNoCMOnly(e.target.checked)} />
          Only accounts with no CM
        </label>
      </div>

      {/* Toast / errors */}
      {toast && (
        <div style={{
          padding: '12px 16px', marginBottom: 14, borderRadius: 10,
          background: 'rgba(46,108,84,0.10)', border: '1px solid rgba(46,108,84,0.32)',
          color: 'var(--ink)', fontSize: 13,
        }}>{toast}</div>
      )}
      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: 14, borderRadius: 10,
          background: 'rgba(181,72,61,0.08)', border: '1px solid rgba(181,72,61,0.28)',
          color: 'var(--rust, #B5483D)', fontSize: 13,
        }}>{error}</div>
      )}

      {loading && <div style={{ padding: 24, color: 'var(--ink-soft)' }}>Loading…</div>}

      {/* Account table */}
      {!loading && (
        <div style={{
          background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(15,40,85,0.10)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(15,40,85,0.04)', borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
                <Th width="36">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleAll}
                  />
                </Th>
                <Th>Tier</Th>
                <Th>Party</Th>
                <Th>Family</Th>
                <Th>Exec</Th>
                <Th>Current CM</Th>
                <Th align="right">Outstanding</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
                  <Td><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleRow(a.id)} /></Td>
                  <Td><TierBadge tier={a.tier} /></Td>
                  <Td>
                    <button onClick={() => setOpenId(a.id)} style={{
                      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                      fontWeight: 600, color: 'var(--navy-deep)', textAlign: 'left',
                      fontFamily: 'inherit', fontSize: 13,
                    }}>{a.party}</button>
                  </Td>
                  <Td>{a.family || '—'}</Td>
                  <Td>{a.exec || '—'}</Td>
                  <Td>{a.cm || <span style={{ color: 'var(--rust, #B5483D)', fontWeight: 600 }}>— none —</span>}</Td>
                  <Td align="right" mono>{fmtINR(a.bill)}</Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                  No accounts match your filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky action bar */}
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 16, marginTop: 18,
          background: '#fff', border: '1px solid rgba(15,40,85,0.18)',
          borderRadius: 12, padding: '14px 18px',
          boxShadow: '0 10px 30px rgba(15,40,85,0.18)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 10,
        }}>
          <div style={{ fontSize: 13, color: 'var(--ink)' }}>
            <b>{selected.size}</b> account{selected.size === 1 ? '' : 's'} selected
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <select value={targetCM} onChange={e => setTargetCM(e.target.value)} style={{ ...inputStyle, minWidth: 200 }}>
              <option value="">Choose Collection Manager…</option>
              {cms.map(c => <option key={c.name} value={c.name}>{c.name} ({c.role})</option>)}
            </select>
            <button
              onClick={assign}
              disabled={!targetCM || assigning}
              style={{
                padding: '10px 18px', borderRadius: 8,
                background: !targetCM || assigning
                  ? 'rgba(15,40,85,0.25)'
                  : 'linear-gradient(180deg,#1A3F7E,#0F2855)',
                color: '#fff', border: 'none', cursor: !targetCM || assigning ? 'not-allowed' : 'pointer',
                fontSize: 11.5, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase',
              }}>
              {assigning ? 'Assigning…' : `Assign to ${targetCM || '…'}`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              style={{
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid rgba(15,40,85,0.22)',
                color: 'var(--ink-soft)', fontSize: 11.5, fontWeight: 700,
                letterSpacing: '.18em', textTransform: 'uppercase',
              }}>Clear</button>
          </div>
        </div>
      )}

      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '1px solid rgba(15,40,85,0.18)', borderRadius: 8,
  fontSize: 13, color: 'var(--ink)', background: '#fff',
  fontFamily: 'inherit', outline: 'none',
};

function Th({ children, align, width }: { children: React.ReactNode; align?: 'left' | 'right'; width?: string }) {
  return (
    <th style={{
      textAlign: align || 'left', width,
      padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700,
    }}>{children}</th>
  );
}
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '11px 14px',
      color: 'var(--ink)',
      verticalAlign: 'middle',
      fontFamily: mono ? 'inherit' : undefined,
      fontVariantNumeric: mono ? 'tabular-nums' : undefined,
      fontWeight: mono ? 600 : undefined,
    }}>{children}</td>
  );
}
