// ============================================================
// /portal/queries — the accounts "Queries" desk (form responses).
// ============================================================
// Accounts read every submitted query, open its attachments, add remarks,
// CLASSIFY the related account (supplier / client / card / payment — the form
// recommends one) and then PUSH (dry-run: marks Accepted, no FinBook write) or
// REJECT it. The OWNER also gets a "Forms" tab to reshape the registry: which
// fields a form has, who may fill it, and who may view the responses.
// ============================================================
import { Fragment, useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtDate } from '../../lib/fmt';
import {
  CLASSIFY_TYPES, CLASSIFY_LABEL, QUERY_STATUS_LABEL, QUERY_STATUS_COLOR, recommendClassify,
  type QueryField,
} from '../../lib/queries';

type Remark = { by?: string; name?: string; at?: string; text: string };
type Query = {
  id: string; formKey: string; formTitle: string | null; values: Record<string, any>;
  status: string; classifyType: string | null; relatedParty: string | null; remarks: Remark[];
  submittedByName: string | null; department: string | null; reviewedByName: string | null;
  createdAt: string; fileCount?: number;
};
type Summary = { open: number; accepted: number; rejected: number };
type FormDef = { key: string; title: string; fields: QueryField[]; defaultClassify: string | null };
type FileMeta = { id: string; kind: string | null; fileName: string; size: number; uploadedByName: string | null };

export default function QueriesPage() {
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [tab, setTab] = useState<'responses' | 'forms'>('responses');

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(r => { if (r?.ok && r.user) setMe({ role: r.user.role }); }).catch(() => {});
  }, []);
  const isOwner = me?.role === 'owner';

  return (
    <AppShell title="Queries" crumb="Queries">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Queries</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            Submitted forms land here. Read, classify the related account, then push or reject. (Pushing marks the query accepted — it does not post to FinBook yet.)
          </p>
        </div>
        {isOwner && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setTab('responses')} style={tabBtn(tab === 'responses')}>Responses</button>
            <button onClick={() => setTab('forms')} style={tabBtn(tab === 'forms')}>Forms</button>
          </div>
        )}
      </div>

      {tab === 'responses' ? <ResponsesTab /> : <FormsTab />}
    </AppShell>
  );
}

// ─── Responses ────────────────────────────────────────────────
function ResponsesTab() {
  const [rows, setRows] = useState<Query[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState('');
  const [formKey, setFormKey] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formMap, setFormMap] = useState<Record<string, FormDef>>({});
  const [formList, setFormList] = useState<FormDef[]>([]);

  function load() {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (formKey) params.set('formKey', formKey);
    if (q.trim()) params.set('q', q.trim());
    fetch(`/api/queries?${params.toString()}`)
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed to load'); setRows(r.data.queries || []); setSummary(r.data.summary || null); })
      .catch(e => setError(e.message));
  }
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, formKey, q]);
  useEffect(() => {
    // Forms whose responses land on this desk (routed forms excluded), for the
    // field-label map AND the "which form" filter dropdown.
    fetch('/api/queries/forms?mode=responses').then(r => r.json()).then(r => {
      if (r?.ok) {
        const m: Record<string, FormDef> = {};
        for (const f of r.forms) m[f.key] = f;
        setFormMap(m);
        setFormList(r.forms || []);
      }
    }).catch(() => {});
  }, []);

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <>
      {error && <div style={errBox}>Failed: {error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, margin: '4px 0 16px' }}>
        <Stat label="Open" value={summary ? summary.open : '—'} color={summary && summary.open > 0 ? '#C98A14' : 'var(--t-3)'} />
        <Stat label="Accepted" value={summary ? summary.accepted : '—'} color="#2E7D4F" />
        <Stat label="Rejected" value={summary ? summary.rejected : '—'} color="#B5483D" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={formKey} onChange={e => setFormKey(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }}>
          <option value="">All forms</option>
          {formList.map(f => <option key={f.key} value={f.key}>{f.title}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="">All statuses</option>
          {Object.entries(QUERY_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search form, person, account…" style={{ ...inputStyle, maxWidth: 280 }} />
      </div>

      {!rows && !error && <div style={{ padding: 28, color: 'var(--t-3)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={emptyBox}><h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No queries yet</h3>
          <p style={{ color: 'var(--t-2)' }}>Submissions from the Fill a Query page will show up here.</p></div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
              <Th>Form</Th><Th>From</Th><Th>Classified</Th><Th>Files</Th><Th>Status</Th><Th align="right"></Th>
            </tr></thead>
            <tbody>
              {rows.map(qr => (
                <Fragment key={qr.id}>
                  <tr style={{ borderBottom: expanded.has(qr.id) ? 'none' : '1px solid var(--line, #e7eaf0)', opacity: qr.status === 'rejected' ? 0.65 : 1 }}>
                    <Td><div style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{qr.formTitle || qr.formKey}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--t-3)' }}>{fmtDate(qr.createdAt)}</div></Td>
                    <Td><span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>{qr.submittedByName || '—'}</span>
                      {qr.department && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>{qr.department}</div>}</Td>
                    <Td>{qr.classifyType
                      ? <span style={{ fontSize: 12 }}><strong>{CLASSIFY_LABEL[qr.classifyType]}</strong>{qr.relatedParty ? <span style={{ color: 'var(--t-2)' }}> · {qr.relatedParty}</span> : ''}</span>
                      : <span style={{ fontSize: 11.5, color: 'var(--t-3)' }}>—</span>}</Td>
                    <Td><span style={{ fontSize: 12, color: qr.fileCount ? 'var(--navy)' : 'var(--t-3)' }}>{qr.fileCount ? `📎 ${qr.fileCount}` : '—'}</span></Td>
                    <Td><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: QUERY_STATUS_COLOR[qr.status] || 'var(--t-2)' }}>{QUERY_STATUS_LABEL[qr.status] || qr.status}</span></Td>
                    <Td align="right"><button onClick={() => toggle(qr.id)} style={rowBtn}>{expanded.has(qr.id) ? 'Close' : 'Open'}</button></Td>
                  </tr>
                  {expanded.has(qr.id) && (
                    <tr style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                      <td colSpan={6} style={{ padding: 0, background: 'var(--bg-2, #f6f8fb)' }}>
                        <QueryDetail q={qr} form={formMap[qr.formKey]} onChange={load} onError={setError} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function QueryDetail({ q, form, onChange, onError }: { q: Query; form?: FormDef; onChange: () => void; onError: (m: string) => void }) {
  const [classify, setClassify] = useState<string>(q.classifyType || recommendClassify(form || {}) || '');
  const [party, setParty] = useState(q.relatedParty || '');
  const [remark, setRemark] = useState('');
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/files?entityType=query&entityId=${encodeURIComponent(q.id)}`)
      .then(r => r.json()).then(r => { if (r?.ok) setFiles(r.files); }).catch(() => {});
  }, [q.id]);

  const recommended = recommendClassify(form || {});
  const fieldLabel = (k: string) => form?.fields.find(f => f.key === k)?.label || k;
  const closed = q.status !== 'open';

  async function patch(body: any) {
    setBusy(true);
    const res = await fetch(`/api/queries/${encodeURIComponent(q.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(x => x.json()).catch(() => null);
    setBusy(false);
    if (!res?.ok) { onError(res?.error || 'Update failed'); return false; }
    onChange();
    return true;
  }

  return (
    <div style={{ padding: '16px 18px', display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
      {/* Submitted values */}
      <div>
        <div style={detailHd}>Submitted</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {Object.keys(q.values || {}).length === 0 && <div style={{ fontSize: 12, color: 'var(--t-3)' }}>No field values.</div>}
          {Object.entries(q.values || {}).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12.5 }}>
              <span style={{ color: 'var(--t-3)', minWidth: 120 }}>{fieldLabel(k)}</span>
              <span style={{ color: 'var(--navy-deep)' }}>{String(v ?? '') || '—'}</span>
            </div>
          ))}
        </div>
        <div style={{ ...detailHd, marginTop: 16 }}>Attachments</div>
        {files === null && <div style={{ fontSize: 12, color: 'var(--t-3)' }}>Loading…</div>}
        {files && files.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-3)' }}>No files attached.</div>}
        {files && files.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginTop: 4 }}>
            <span>📎</span>
            {f.kind && f.kind !== 'attachment' && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--t-3)', background: 'var(--line, #eef1f6)', padding: '1px 6px', borderRadius: 5 }}>{fieldLabel(f.kind)}</span>}
            <a href={`/api/files/${encodeURIComponent(f.id)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--navy)', fontWeight: 600, textDecoration: 'none' }}>{f.fileName}</a>
            <span style={{ color: 'var(--t-3)', fontSize: 11 }}>{f.uploadedByName || ''}</span>
          </div>
        ))}
      </div>

      {/* Classify + actions */}
      <div>
        <div style={detailHd}>Classify the related account</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {CLASSIFY_TYPES.map(t => (
            <button key={t} onClick={() => setClassify(t)} disabled={closed} style={classChip(classify === t)}>
              {CLASSIFY_LABEL[t]}{recommended === t ? ' ★' : ''}
            </button>
          ))}
        </div>
        {recommended && <div style={{ fontSize: 11, color: 'var(--t-3)', marginBottom: 8 }}>★ recommended for this form</div>}
        <input value={party} onChange={e => setParty(e.target.value)} disabled={closed} placeholder="Related account / party name" style={{ ...inputStyle, marginBottom: 8 }} />
        {!closed && (
          <button disabled={busy} onClick={() => patch({ action: 'classify', classifyType: classify || null, relatedParty: party || null })} style={ghostBtn}>Save classification</button>
        )}

        <div style={{ ...detailHd, marginTop: 16 }}>Remarks</div>
        <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
          {(q.remarks || []).length === 0 && <div style={{ fontSize: 12, color: 'var(--t-3)' }}>No remarks yet.</div>}
          {(q.remarks || []).map((r, idx) => (
            <div key={idx} style={{ fontSize: 12, color: 'var(--t-1)' }}>
              <span style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{r.name || 'Someone'}:</span> {r.text}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Add a remark…" style={{ ...inputStyle, flex: 1 }} />
          <button disabled={busy || !remark.trim()} onClick={async () => { if (await patch({ action: 'remark', text: remark })) setRemark(''); }} style={ghostBtn}>Add</button>
        </div>

        {!closed && (
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button disabled={busy} onClick={() => patch({ action: 'push' })} style={addBtn}>PUSH (accept)</button>
            <button disabled={busy} onClick={() => { const note = window.prompt('Reason for rejecting? (optional)') ?? ''; patch({ action: 'reject', note }); }} style={ghostBtn}>Reject</button>
          </div>
        )}
        {closed && <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--t-3)' }}>{q.status === 'accepted' ? 'Accepted (dry-run — not posted to FinBook)' : 'Rejected'}{q.reviewedByName ? ` · by ${q.reviewedByName}` : ''}</div>}
      </div>
    </div>
  );
}

// ─── Forms registry (owner) ───────────────────────────────────
function FormsTab() {
  const [forms, setForms] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch('/api/queries/forms?mode=manage').then(r => r.json())
      .then(r => { if (r?.ok) setForms(r.forms); else setError(r?.error || 'Failed to load'); }).catch(e => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(f: any) {
    const res = await fetch(`/api/queries/forms/${encodeURIComponent(f.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !f.active }),
    }).then(x => x.json()).catch(() => null);
    if (!res?.ok) { setError(res?.error || 'Update failed'); return; }
    load();
  }

  return (
    <>
      {error && <div style={errBox}>Failed: {error}</div>}
      <p style={{ fontSize: 12.5, color: 'var(--t-2)', marginBottom: 14, maxWidth: 680 }}>
        These are the forms people can fill. Toggle a form on/off, or edit who may fill it, who sees the responses, its fields, and the recommended classification.
      </p>
      {!forms && <div style={{ padding: 24, color: 'var(--t-3)' }}>Loading…</div>}
      {forms && forms.map(f => <FormEditor key={f.id} form={f} onChange={load} onToggle={() => toggleActive(f)} onError={setError} />)}
      {forms && <NewFormButton onChange={load} onError={setError} />}
    </>
  );
}

function FormEditor({ form, onChange, onToggle, onError }: { form: any; onChange: () => void; onToggle: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description || '');
  const [fillRoles, setFillRoles] = useState((form.fillRoles || []).join(', '));
  const [viewRoles, setViewRoles] = useState((form.viewRoles || []).join(', '));
  const [fillDepts, setFillDepts] = useState((form.fillDepts || []).join(', '));
  const [defaultClassify, setDefaultClassify] = useState(form.defaultClassify || '');
  const [fields, setFields] = useState<QueryField[]>(form.fields || []);
  const [saving, setSaving] = useState(false);

  function setField(i: number, patch: Partial<QueryField>) { setFields(fs => fs.map((f, idx) => idx === i ? { ...f, ...patch } : f)); }
  function addField() { setFields(fs => [...fs, { key: `field${fs.length + 1}`, label: 'New field', type: 'text' }]); }
  function removeField(i: number) { setFields(fs => fs.filter((_, idx) => idx !== i)); }

  async function save() {
    setSaving(true);
    const body = {
      title, description: description || null,
      fillRoles: fillRoles.split(',').map((s: string) => s.trim()).filter(Boolean),
      viewRoles: viewRoles.split(',').map((s: string) => s.trim()).filter(Boolean),
      fillDepts: fillDepts.split(',').map((s: string) => s.trim()).filter(Boolean),
      defaultClassify: defaultClassify || null,
      fields,
    };
    const res = await fetch(`/api/queries/forms/${encodeURIComponent(form.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(x => x.json()).catch(() => null);
    setSaving(false);
    if (!res?.ok) { onError(res?.error || 'Save failed'); return; }
    onChange();
  }

  return (
    <div style={{ ...cardBox, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, color: 'var(--navy-deep)' }}>{form.title}</span>
          <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 8 }}>{form.key}</span>
          {!form.active && <span style={{ fontSize: 10.5, color: '#B5483D', marginLeft: 8, fontWeight: 700 }}>OFF</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onToggle} style={rowBtn}>{form.active ? 'Disable' : 'Enable'}</button>
          <button onClick={() => setOpen(o => !o)} style={rowBtn}>{open ? 'Close' : 'Edit'}</button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Lbl t="Title"><input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} /></Lbl>
            <Lbl t="Recommended classification"><select value={defaultClassify} onChange={e => setDefaultClassify(e.target.value)} style={inputStyle}>
              <option value="">— none —</option>{CLASSIFY_TYPES.map(t => <option key={t} value={t}>{CLASSIFY_LABEL[t]}</option>)}
            </select></Lbl>
          </div>
          <Lbl t="Description"><input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} /></Lbl>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Lbl t="Who may fill (roles, blank = everyone)"><input value={fillRoles} onChange={e => setFillRoles(e.target.value)} placeholder="e.g. accounts, hr" style={inputStyle} /></Lbl>
            <Lbl t="Departments (or 'all')"><input value={fillDepts} onChange={e => setFillDepts(e.target.value)} style={inputStyle} /></Lbl>
            <Lbl t="Who views responses (roles)"><input value={viewRoles} onChange={e => setViewRoles(e.target.value)} style={inputStyle} /></Lbl>
          </div>

          <div>
            <div style={detailHd}>Fields</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {fields.map((f, i) => (
                <div key={i} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={f.key} onChange={e => setField(i, { key: e.target.value })} placeholder="key" style={{ ...inputStyle, maxWidth: 120 }} />
                    <input value={f.label} onChange={e => setField(i, { label: e.target.value })} placeholder="label" style={{ ...inputStyle, flex: 1 }} />
                    <select value={f.type} onChange={e => setField(i, { type: e.target.value as any })} style={{ ...inputStyle, maxWidth: 130 }}>
                      {['text', 'textarea', 'number', 'money', 'date', 'select', 'account', 'vendor', 'file'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <label style={{ fontSize: 11, color: 'var(--t-2)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <input type="checkbox" checked={!!f.required} onChange={e => setField(i, { required: e.target.checked })} />req
                    </label>
                    <button onClick={() => removeField(i)} style={rowBtn}>✕</button>
                  </div>
                  {f.type === 'select' && (
                    <input
                      value={(f.options || []).join(', ')}
                      onChange={e => setField(i, { options: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
                      placeholder="dropdown options, comma-separated"
                      style={{ ...inputStyle, fontSize: 12, marginLeft: 126 }}
                    />
                  )}
                </div>
              ))}
            </div>
            <button onClick={addField} style={{ ...rowBtn, marginTop: 8 }}>+ Add field</button>
          </div>

          <div><button disabled={saving} onClick={save} style={addBtn}>{saving ? 'SAVING…' : 'SAVE FORM'}</button></div>
        </div>
      )}
    </div>
  );
}

function NewFormButton({ onChange, onError }: { onChange: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!/^[a-z0-9-]+$/.test(key)) { onError('Key must be a lower-case slug (a-z, 0-9, -).'); return; }
    if (!title.trim()) { onError('Enter a title.'); return; }
    setSaving(true);
    const res = await fetch('/api/queries/forms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, title, fields: [], fillDepts: ['all'] }),
    }).then(x => x.json()).catch(() => null);
    setSaving(false);
    if (!res?.ok) { onError(res?.error || 'Create failed'); return; }
    setOpen(false); setKey(''); setTitle(''); onChange();
  }

  if (!open) return <button onClick={() => setOpen(true)} style={addBtn}>+ NEW FORM</button>;
  return (
    <div style={{ ...cardBox, padding: 14, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Lbl t="Key (slug)"><input value={key} onChange={e => setKey(e.target.value)} placeholder="e.g. courier" style={{ ...inputStyle, maxWidth: 180 }} /></Lbl>
        <Lbl t="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Courier dispatch" style={{ ...inputStyle, maxWidth: 240 }} /></Lbl>
        <button disabled={saving} onClick={create} style={addBtn}>{saving ? 'CREATING…' : 'CREATE'}</button>
        <button onClick={() => setOpen(false)} style={ghostBtn}>CANCEL</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--t-3)', marginTop: 8 }}>Create the form, then click Edit to add its fields and permissions.</div>
    </div>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Stat({ label, value, color }: { label: string; value: any; color: string }) {
  return <div style={statCard}><div style={statLabel}>{label}</div><div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div></div>;
}
function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={fieldLbl}>{t}</span>{children}</label>;
}
function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '11px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ textAlign: align || 'left', padding: '10px 14px', color: 'var(--t-1)', verticalAlign: 'middle' }}>{children}</td>;
}

const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '7px 16px', borderRadius: 8, border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line-2, #d0d6e0)', background: active ? 'var(--navy-deep)' : '#fff', color: active ? '#fff' : 'var(--t-2)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' });
const classChip = (active: boolean): React.CSSProperties => ({ padding: '5px 11px', borderRadius: 7, border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line-2, #d0d6e0)', background: active ? 'rgba(26,111,168,.1)' : '#fff', color: active ? 'var(--navy)' : 'var(--t-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
const fieldLbl: React.CSSProperties = { display: 'block', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 5 };
const detailHd: React.CSSProperties = { fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 8 };
const inputStyle: React.CSSProperties = { width: '100%', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff' };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: 'var(--t-2)', border: '1px solid var(--line-2, #d0d6e0)', borderRadius: 10, padding: '9px 14px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer' };
const rowBtn: React.CSSProperties = { background: '#fff', color: 'var(--t-2)', border: '1px solid var(--line-2, #d0d6e0)', borderRadius: 6, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' };
const statCard: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: '12px 14px' };
const statLabel: React.CSSProperties = { fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
