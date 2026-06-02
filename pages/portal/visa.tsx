// ============================================================
// /portal/visa — Visa desk: application tracker.
// ============================================================
// Every visa case the desk is working — applicant, country, stage and
// appointment. Scope tabs All / My cases / Upcoming appointments, a stage
// filter + search, a "+ New application" form, and per-row stage advance.
// Setting an appointment date drops a reminder into the agent's Tasks
// inbox (handled server-side via lib/visa → the shared Task engine).
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR, fmtDate } from '../../lib/fmt';

type VisaApp = {
  id: string; applicantName: string; passportNo: string | null;
  contact: string | null; email: string | null; nationality: string | null;
  country: string; visaType: string; stage: string; priority: string;
  appointmentAt: string | null; submittedAt: string | null; decisionAt: string | null;
  fee: string | number; amountCollected: string | number;
  vendor: string | null; refNo: string | null;
  assigneeExecId: string | null; assigneeName: string | null;
  notes: string | null; createdAt: string;
};

const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My Cases' },
  { key: 'upcoming', label: 'Upcoming Appts' },
];
const STAGES = ['enquiry', 'documentation', 'appointment', 'submitted', 'processing', 'approved', 'rejected', 'delivered'];
const STAGE_LABEL: Record<string, string> = {
  enquiry: 'Enquiry', documentation: 'Documentation', appointment: 'Appointment',
  submitted: 'Submitted', processing: 'Processing', approved: 'Approved',
  rejected: 'Rejected', delivered: 'Delivered',
};
const STAGE_COLOR: Record<string, string> = {
  enquiry: '#1A3F7E', documentation: '#1A6FA8', appointment: '#7A4FB5',
  submitted: '#C98A14', processing: '#B5731D', approved: '#2E7D4F',
  rejected: '#B5483D', delivered: '#3C7D5A',
};
const VISA_TYPES = ['tourist', 'business', 'student', 'work', 'transit', 'medical', 'other'];
const PRIO_COLOR: Record<string, string> = {
  urgent: '#B5483D', high: '#C98A14', normal: 'var(--ink-soft)', low: 'var(--ink-soft)',
};

export default function VisaPage() {
  const [scope, setScope] = useState('all');
  const [stageFilter, setStageFilter] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<VisaApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  // quick-add
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [applicantName, setApplicantName] = useState('');
  const [country, setCountry] = useState('');
  const [visaType, setVisaType] = useState('tourist');
  const [contact, setContact] = useState('');
  const [appointmentAt, setAppointmentAt] = useState('');
  const [fee, setFee] = useState('');
  const [priority, setPriority] = useState('normal');

  function load() {
    setError(null);
    const p = new URLSearchParams({ scope });
    if (stageFilter) p.set('stage', stageFilter);
    if (q.trim()) p.set('q', q.trim());
    fetch(`/api/visa?${p.toString()}`)
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed'); setRows(r.data.applications || []); })
      .catch(e => setError(e.message));
  }
  useEffect(load, [scope, stageFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!applicantName.trim() || !country.trim()) return;
    setAdding(true);
    try {
      const r = await fetch('/api/visa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicantName: applicantName.trim(),
          country: country.trim(),
          visaType,
          contact: contact.trim() || null,
          appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null,
          fee: fee ? Number(fee) : 0,
          priority,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Could not add');
      setApplicantName(''); setCountry(''); setVisaType('tourist'); setContact('');
      setAppointmentAt(''); setFee(''); setPriority('normal'); setShowAdd(false);
      load();
    } catch (e: any) { setError(e.message); }
    finally { setAdding(false); }
  }

  async function patch(id: string, body: any) {
    try {
      const r = await fetch(`/api/visa/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Update failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove(a: VisaApp) {
    const ok = await confirm({
      title: `Delete application for ${a.applicantName}?`,
      body: 'This permanently removes the visa record and its appointment reminder.',
      confirmLabel: 'Delete', destructive: true,
    });
    if (!ok) return;
    try {
      const r = await fetch(`/api/visa/${encodeURIComponent(a.id)}`, { method: 'DELETE' }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Delete failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  // Stage counts for the board strip.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STAGES) c[s] = 0;
    (rows || []).forEach(a => { c[a.stage] = (c[a.stage] || 0) + 1; });
    return c;
  }, [rows]);

  return (
    <AppShell title="Visa" crumb="Visa">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Visa Desk</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            Every application — applicant, country, stage and appointment. Setting an appointment date drops a reminder into your Tasks.
          </p>
        </div>
        <button onClick={() => setShowAdd(s => !s)} style={addBtn}>{showAdd ? 'CLOSE' : '+ NEW APPLICATION'}</button>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {/* Quick add */}
      {showAdd && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', padding: 14, background: 'var(--bg-2, #f6f8fb)', borderRadius: 12, border: '1px solid var(--line, #e7eaf0)' }}>
          <input value={applicantName} onChange={e => setApplicantName(e.target.value)} placeholder="Applicant name…" style={{ ...inp, flex: 1, minWidth: 180 }} />
          <input value={country} onChange={e => setCountry(e.target.value)} placeholder="Country / authority (Schengen, USA…)" style={{ ...inp, width: 220 }} />
          <select value={visaType} onChange={e => setVisaType(e.target.value)} style={sel} title="Visa type">
            {VISA_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone / contact" style={{ ...inp, width: 150 }} />
          <input type="datetime-local" value={appointmentAt} onChange={e => setAppointmentAt(e.target.value)} style={{ ...inp, width: 200 }} title="Appointment (optional)" />
          <input value={fee} onChange={e => setFee(e.target.value)} placeholder="Fee ₹" type="number" style={{ ...inp, width: 110 }} />
          <select value={priority} onChange={e => setPriority(e.target.value)} style={sel}>
            <option value="low">Low</option><option value="normal">Normal</option>
            <option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <button onClick={add} disabled={adding || !applicantName.trim() || !country.trim()} style={btnPrimary}>Add</button>
        </div>
      )}

      {/* Stage board strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {STAGES.map(s => (
          <button key={s} onClick={() => setStageFilter(stageFilter === s ? '' : s)}
            style={{
              flex: 1, minWidth: 92, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              border: stageFilter === s ? `1.5px solid ${STAGE_COLOR[s]}` : '1px solid rgba(15,40,85,0.12)',
              background: stageFilter === s ? `${STAGE_COLOR[s]}10` : '#fff',
            }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: STAGE_COLOR[s] }}>{STAGE_LABEL[s]}</div>
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
          placeholder="Search applicant / passport / country / ref…" style={{ ...inp, marginLeft: 'auto', width: 280 }} />
      </div>

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No applications here</h3>
          <p style={{ color: 'var(--t-2)' }}>Click <strong>+ New application</strong> to log the first one.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          {rows.map(a => {
            const due = Math.max(0, Number(a.fee) - Number(a.amountCollected));
            const apptSoon = a.appointmentAt && new Date(a.appointmentAt) >= new Date();
            const closed = a.stage === 'approved' || a.stage === 'rejected' || a.stage === 'delivered';
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--line, #e7eaf0)', opacity: a.stage === 'rejected' ? 0.62 : 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#fff', background: STAGE_COLOR[a.stage] || '#777', padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>{STAGE_LABEL[a.stage] || a.stage}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>
                    {a.applicantName}
                    <span style={{ fontWeight: 400, color: 'var(--t-2)', fontSize: 13 }}> · {a.country}</span>
                    <span style={{ fontSize: 11, color: 'var(--t-3)' }}> ({a.visaType})</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
                    {[a.passportNo ? `Passport ${a.passportNo}` : null, a.refNo ? `Ref ${a.refNo}` : null, a.assigneeName ? `@${a.assigneeName}` : null]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {a.appointmentAt && (
                  <span style={{ fontSize: 12, fontWeight: apptSoon ? 700 : 400, color: apptSoon ? '#7A4FB5' : 'var(--t-3)', whiteSpace: 'nowrap' }}
                    title="Appointment">📅 {fmtDate(a.appointmentAt)}</span>
                )}
                {due > 0 && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rust)', whiteSpace: 'nowrap' }}>{fmtINR(due)} due</span>}
                {a.priority !== 'normal' && <span style={{ fontSize: 11, fontWeight: 700, color: PRIO_COLOR[a.priority] }}>{a.priority}</span>}
                <select value={a.stage} onChange={e => patch(a.id, { stage: e.target.value })} style={{ ...sel, fontSize: 12, padding: '5px 8px' }} title="Advance stage">
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                <button onClick={() => remove(a)} style={btnLink} title="Delete">Delete</button>
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
