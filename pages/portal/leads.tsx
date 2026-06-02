// ============================================================
// /portal/leads — the cross-department sales pipeline.
// ============================================================
// Marketing + the booking/package/visa desks capture and work leads here.
// Scope tabs Mine / Department / All (managers), a stage board, quick-add,
// and per-row stage advance / assign. A won lead can be converted into the
// department record it became (the relatedType/relatedId seam).
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Lead = {
  id: string; name: string; contact: string | null; email: string | null;
  source: string; department: string | null; stage: string; priority: string;
  assigneeExecId: string | null; assigneeName: string | null;
  estValue: string | number | null; notes: string | null;
  lostReason: string | null; convertedType: string | null; convertedId: string | null;
  lastActivityAt: string | null; createdAt: string;
};

const SCOPES = [
  { key: 'mine', label: 'My Leads' },
  { key: 'department', label: 'Department' },
  { key: 'all', label: 'All' },
];
const STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost'];
const STAGE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', quoted: 'Quoted',
  negotiating: 'Negotiating', won: 'Won', lost: 'Lost',
};
const STAGE_COLOR: Record<string, string> = {
  new: '#1A3F7E', contacted: '#1A6FA8', quoted: '#C98A14',
  negotiating: '#B5731D', won: '#2E7D4F', lost: '#B5483D',
};
const SOURCES = ['website', 'whatsapp', 'call', 'walkin', 'referral', 'instagram', 'other'];
const DEPTS = [
  { key: 'domestic-reservations', label: 'Domestic Reservations' },
  { key: 'domestic-package', label: 'Domestic Package' },
  { key: 'international-packages', label: 'International Packages' },
  { key: 'visa', label: 'Visa' },
];
const DEPT_LABEL: Record<string, string> = Object.fromEntries(DEPTS.map(d => [d.key, d.label]));
const PRIO_COLOR: Record<string, string> = {
  urgent: '#B5483D', high: '#C98A14', normal: 'var(--ink-soft)', low: 'var(--ink-soft)',
};

export default function LeadsPage() {
  const [scope, setScope] = useState('all');
  const [stageFilter, setStageFilter] = useState('');
  const [q, setQ] = useState('');
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // quick-add
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [source, setSource] = useState('other');
  const [department, setDepartment] = useState('');
  const [estValue, setEstValue] = useState('');
  const [priority, setPriority] = useState('normal');

  function load() {
    setError(null);
    const p = new URLSearchParams({ scope });
    if (stageFilter) p.set('stage', stageFilter);
    if (q.trim()) p.set('q', q.trim());
    fetch(`/api/leads?${p.toString()}`)
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed'); setLeads(r.leads || []); })
      .catch(e => setError(e.message));
  }
  useEffect(load, [scope, stageFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const r = await fetch('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          contact: contact.trim() || null,
          source,
          department: department || null,
          estValue: estValue ? Number(estValue) : null,
          priority,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Could not add');
      setName(''); setContact(''); setSource('other'); setDepartment(''); setEstValue(''); setPriority('normal');
      load();
    } catch (e: any) { setError(e.message); }
    finally { setAdding(false); }
  }

  async function patch(id: string, body: any) {
    try {
      const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Update failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  // Stage counts for the board strip.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STAGES) c[s] = 0;
    (leads || []).forEach(l => { c[l.stage] = (c[l.stage] || 0) + 1; });
    return c;
  }, [leads]);

  return (
    <AppShell title="Leads" crumb="Sales Pipeline">
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCOPES.map(s => (
          <button key={s.key} onClick={() => setScope(s.key)} style={chip(scope === s.key)}>{s.label}</button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }}
          placeholder="Search name / contact / email…" style={{ ...inp, marginLeft: 'auto', width: 240 }} />
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={sel}>
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </div>

      {/* Stage board strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {STAGES.map(s => (
          <button key={s} onClick={() => setStageFilter(stageFilter === s ? '' : s)}
            style={{
              flex: 1, minWidth: 96, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              border: stageFilter === s ? `1.5px solid ${STAGE_COLOR[s]}` : '1px solid rgba(15,40,85,0.12)',
              background: stageFilter === s ? `${STAGE_COLOR[s]}10` : '#fff',
            }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: STAGE_COLOR[s] }}>{STAGE_LABEL[s]}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{counts[s] ?? 0}</div>
          </button>
        ))}
      </div>

      {/* Quick add */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Lead name…"
          onKeyDown={e => { if (e.key === 'Enter') add(); }} style={{ ...inp, flex: 1, minWidth: 180 }} />
        <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone / contact" style={{ ...inp, width: 150 }} />
        <select value={source} onChange={e => setSource(e.target.value)} style={sel} title="Source">
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)} style={sel} title="Route to department">
          <option value="">— Dept —</option>
          {DEPTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <input value={estValue} onChange={e => setEstValue(e.target.value)} placeholder="Est ₹" type="number" style={{ ...inp, width: 110 }} />
        <select value={priority} onChange={e => setPriority(e.target.value)} style={sel}>
          <option value="low">Low</option><option value="normal">Normal</option>
          <option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <button onClick={add} disabled={adding || !name.trim()} style={btnPrimary}>Add lead</button>
      </div>

      {error && <div style={{ padding: 12, color: 'var(--rust)' }}>{error}</div>}
      {leads === null && !error && <div style={{ padding: 32, color: 'var(--ink-soft)' }}>Loading…</div>}
      {leads && leads.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>No leads here yet.</div>
      )}

      {leads && leads.length > 0 && (
        <div style={{ borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)', overflow: 'hidden' }}>
          {leads.map(l => {
            const closed = l.stage === 'won' || l.stage === 'lost';
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid rgba(15,40,85,0.06)', opacity: l.stage === 'lost' ? 0.6 : 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#fff', background: STAGE_COLOR[l.stage] || '#777', padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>{STAGE_LABEL[l.stage] || l.stage}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{l.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    {[l.contact, l.source, l.department ? DEPT_LABEL[l.department] || l.department : null, l.assigneeName ? `@${l.assigneeName}` : null]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {l.estValue != null && Number(l.estValue) > 0 && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmtMoney(l.estValue)}</span>
                )}
                {l.priority !== 'normal' && <span style={{ fontSize: 11, fontWeight: 700, color: PRIO_COLOR[l.priority] }}>{l.priority}</span>}
                {!closed && (
                  <select value={l.stage} onChange={e => patch(l.id, { stage: e.target.value })} style={{ ...sel, fontSize: 12, padding: '5px 8px' }} title="Advance stage">
                    {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                )}
                {closed && (
                  <button onClick={() => patch(l.id, { stage: 'contacted' })} style={btnLink} title="Reopen">Reopen</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function fmtMoney(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return '';
  return '₹' + n.toLocaleString('en-IN');
}

const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, border: active ? '1px solid var(--navy-deep, #1A3F7E)' : '1px solid rgba(15,40,85,0.2)', background: active ? 'var(--navy-deep, #1A3F7E)' : '#fff', color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,40,85,0.2)', fontSize: 13, boxSizing: 'border-box' };
const sel: React.CSSProperties = { ...inp };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, background: 'var(--navy-deep, #1A3F7E)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnLink: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--navy-deep, #1A3F7E)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 };
