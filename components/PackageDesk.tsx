// ============================================================
// components/PackageDesk.tsx — shared workspace for both package desks.
// ============================================================
// Rendered by /portal/domestic-package and /portal/international-packages
// with the matching `department` prop. One component, one API
// (/api/packages?department=…), so the two desks stay in lock-step.
// Stage board strip, scope tabs, search, inline add, per-row stage
// advance. A confirmed trip with a departure date drops a voucher-prep
// reminder into the agent's Tasks (handled server-side via lib/packages).
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from './AppShell';
import { useConfirm } from './ConfirmProvider';
import { fmtINR, fmtDate } from '../lib/fmt';

type Pkg = {
  id: string; title: string; department: string; customerName: string;
  contact: string | null; email: string | null; destination: string | null;
  paxCount: number; travelStart: string | null; travelEnd: string | null;
  stage: string; priority: string; packageCost: string | number; amountCollected: string | number;
  vendor: string | null; refNo: string | null;
  assigneeExecId: string | null; assigneeName: string | null; notes: string | null; createdAt: string;
};

const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My Files' },
  { key: 'upcoming', label: 'Upcoming Travel' },
];
const STAGES = ['enquiry', 'quoted', 'confirmed', 'vouchers_sent', 'travelling', 'completed', 'cancelled'];
const STAGE_LABEL: Record<string, string> = {
  enquiry: 'Enquiry', quoted: 'Quoted', confirmed: 'Confirmed', vouchers_sent: 'Vouchers Sent',
  travelling: 'Travelling', completed: 'Completed', cancelled: 'Cancelled',
};
const STAGE_COLOR: Record<string, string> = {
  enquiry: '#1A3F7E', quoted: '#C98A14', confirmed: '#1A6FA8', vouchers_sent: '#7A4FB5',
  travelling: '#B5731D', completed: '#2E7D4F', cancelled: '#B5483D',
};
const PRIO_COLOR: Record<string, string> = {
  urgent: '#B5483D', high: '#C98A14', normal: 'var(--ink-soft)', low: 'var(--ink-soft)',
};

export function PackageDesk({ department, title, crumb }: { department: string; title: string; crumb: string }) {
  const [scope, setScope] = useState('all');
  const [stageFilter, setStageFilter] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Pkg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  // quick-add
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pkgTitle, setPkgTitle] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [destination, setDestination] = useState('');
  const [contact, setContact] = useState('');
  const [paxCount, setPaxCount] = useState('1');
  const [travelStart, setTravelStart] = useState('');
  const [packageCost, setPackageCost] = useState('');
  const [priority, setPriority] = useState('normal');

  function load() {
    setError(null);
    const p = new URLSearchParams({ department, scope });
    if (stageFilter) p.set('stage', stageFilter);
    if (q.trim()) p.set('q', q.trim());
    fetch(`/api/packages?${p.toString()}`)
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed'); setRows(r.data.packages || []); })
      .catch(e => setError(e.message));
  }
  useEffect(load, [department, scope, stageFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!pkgTitle.trim() || !customerName.trim()) return;
    setAdding(true);
    try {
      const r = await fetch('/api/packages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department,
          title: pkgTitle.trim(),
          customerName: customerName.trim(),
          destination: destination.trim() || null,
          contact: contact.trim() || null,
          paxCount: paxCount ? Number(paxCount) : 1,
          travelStart: travelStart ? new Date(travelStart).toISOString() : null,
          packageCost: packageCost ? Number(packageCost) : 0,
          priority,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Could not add');
      setPkgTitle(''); setCustomerName(''); setDestination(''); setContact('');
      setPaxCount('1'); setTravelStart(''); setPackageCost(''); setPriority('normal'); setShowAdd(false);
      load();
    } catch (e: any) { setError(e.message); }
    finally { setAdding(false); }
  }

  async function patch(id: string, body: any) {
    try {
      const r = await fetch(`/api/packages/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Update failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove(p: Pkg) {
    const ok = await confirm({
      title: `Delete ${p.title}?`,
      body: 'This permanently removes the package file and its reminder.',
      confirmLabel: 'Delete', destructive: true,
    });
    if (!ok) return;
    try {
      const r = await fetch(`/api/packages/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Delete failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STAGES) c[s] = 0;
    (rows || []).forEach(p => { c[p.stage] = (c[p.stage] || 0) + 1; });
    return c;
  }, [rows]);

  return (
    <AppShell title={title} crumb={crumb}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>{title}</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            Every holiday file — customer, destination, stage and travel dates. Confirmed trips drop a voucher-prep reminder into your Tasks before departure.
          </p>
        </div>
        <button onClick={() => setShowAdd(s => !s)} style={addBtn}>{showAdd ? 'CLOSE' : '+ NEW PACKAGE'}</button>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {showAdd && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', padding: 14, background: 'var(--bg-2, #f6f8fb)', borderRadius: 12, border: '1px solid var(--line, #e7eaf0)' }}>
          <input value={pkgTitle} onChange={e => setPkgTitle(e.target.value)} placeholder="Package title (e.g. Bali 5N/6D)…" style={{ ...inp, flex: 1, minWidth: 200 }} />
          <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" style={{ ...inp, width: 180 }} />
          <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Destination" style={{ ...inp, width: 150 }} />
          <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone / contact" style={{ ...inp, width: 140 }} />
          <input value={paxCount} onChange={e => setPaxCount(e.target.value)} type="number" min={1} placeholder="Pax" style={{ ...inp, width: 70 }} title="Pax" />
          <input type="date" value={travelStart} onChange={e => setTravelStart(e.target.value)} style={{ ...inp, width: 160 }} title="Travel start" />
          <input value={packageCost} onChange={e => setPackageCost(e.target.value)} placeholder="Cost ₹" type="number" style={{ ...inp, width: 120 }} />
          <select value={priority} onChange={e => setPriority(e.target.value)} style={sel}>
            <option value="low">Low</option><option value="normal">Normal</option>
            <option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <button onClick={add} disabled={adding || !pkgTitle.trim() || !customerName.trim()} style={btnPrimary}>Add</button>
        </div>
      )}

      {/* Stage board strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {STAGES.map(s => (
          <button key={s} onClick={() => setStageFilter(stageFilter === s ? '' : s)}
            style={{
              flex: 1, minWidth: 96, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              border: stageFilter === s ? `1.5px solid ${STAGE_COLOR[s]}` : '1px solid rgba(15,40,85,0.12)',
              background: stageFilter === s ? `${STAGE_COLOR[s]}10` : '#fff',
            }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: STAGE_COLOR[s] }}>{STAGE_LABEL[s]}</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink)' }}>{counts[s] ?? 0}</div>
          </button>
        ))}
      </div>

      {/* Scope + search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCOPES.map(s => (
          <button key={s.key} onClick={() => setScope(s.key)} style={chip(scope === s.key)}>{s.label}</button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }}
          placeholder="Search title / customer / destination / ref…" style={{ ...inp, marginLeft: 'auto', width: 280 }} />
      </div>

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No packages here</h3>
          <p style={{ color: 'var(--t-2)' }}>Click <strong>+ New package</strong> to start the first file.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          {rows.map(p => {
            const due = Math.max(0, Number(p.packageCost) - Number(p.amountCollected));
            const soon = p.travelStart && new Date(p.travelStart) >= new Date();
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--line, #e7eaf0)', opacity: p.stage === 'cancelled' ? 0.6 : 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: '#fff', background: STAGE_COLOR[p.stage] || '#777', padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>{STAGE_LABEL[p.stage] || p.stage}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>
                    {p.title}
                    {p.paxCount > 1 && <span style={{ fontSize: 11, color: 'var(--t-3)' }}> · {p.paxCount} pax</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
                    {[p.customerName, p.destination, p.refNo ? `Ref ${p.refNo}` : null, p.assigneeName ? `@${p.assigneeName}` : null]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {p.travelStart && (
                  <span style={{ fontSize: 12, fontWeight: soon ? 700 : 400, color: soon ? '#B5731D' : 'var(--t-3)', whiteSpace: 'nowrap' }} title="Travel start">✈ {fmtDate(p.travelStart)}</span>
                )}
                {due > 0 && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rust)', whiteSpace: 'nowrap' }}>{fmtINR(due)} due</span>}
                {p.priority !== 'normal' && <span style={{ fontSize: 11, fontWeight: 700, color: PRIO_COLOR[p.priority] }}>{p.priority}</span>}
                <select value={p.stage} onChange={e => patch(p.id, { stage: e.target.value })} style={{ ...sel, fontSize: 12, padding: '5px 8px' }} title="Advance stage">
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                <button onClick={() => remove(p)} style={btnLink} title="Delete">Delete</button>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, border: active ? '1px solid var(--navy-deep, #1A3F7E)' : '1px solid rgba(15,40,85,0.2)', background: active ? 'var(--navy-deep, #1A3F7E)' : '#fff', color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,40,85,0.2)', fontSize: 13, boxSizing: 'border-box' };
const sel: React.CSSProperties = { ...inp };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, background: 'var(--navy-deep, #1A3F7E)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnLink: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--rust, #B5483D)', cursor: 'pointer', fontSize: 12, fontWeight: 700 };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '.16em', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(15,40,85,.18)' };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
