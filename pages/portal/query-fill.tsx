// ============================================================
// /portal/query-fill — "Fill a Query" (replaces the loose Google Forms).
// ============================================================
// Shows every form the signed-in user is allowed to fill (the owner controls
// who-fills-what in the registry). Pick a form, fill its fields, optionally
// attach files, and submit — the accounts desk then sees it under Queries.
// Broad access: any role with the 'query-fill' view. Filling does NOT post to
// FinBook; the accounts desk classifies and (dry-run) pushes later.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import type { QueryField } from '../../lib/queries';

type Form = {
  id: string; key: string; title: string; description: string | null;
  fields: QueryField[]; fillDepts: string[]; defaultClassify: string | null;
};
type MyQuery = { id: string; formTitle: string | null; status: string; createdAt: string };

export default function QueryFillPage() {
  const [forms, setForms] = useState<Form[] | null>(null);
  const [mine, setMine] = useState<MyQuery[]>([]);
  const [active, setActive] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function loadForms() {
    fetch('/api/queries/forms?mode=fill')
      .then(r => r.json())
      .then(r => { if (r?.ok) setForms(r.forms); else setError(r?.error || 'Failed to load forms'); })
      .catch(e => setError(e.message));
  }
  function loadMine() {
    fetch('/api/queries?scope=mine')
      .then(r => r.json())
      .then(r => { if (r?.ok) setMine(r.data.queries || []); })
      .catch(() => {});
  }
  useEffect(() => { loadForms(); loadMine(); }, []);

  return (
    <AppShell title="Fill a Query" crumb="Fill a Query">
      <div style={{ maxWidth: 760, marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Fill a Query</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
          Pick a form, fill it in, attach anything relevant, and submit. The accounts desk picks it up under <strong>Queries</strong>.
        </p>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}
      {okMsg && <div style={okBox}>{okMsg}</div>}

      {!active && (
        <>
          {!forms && <div style={{ padding: 24, color: 'var(--t-3)' }}>Loading forms…</div>}
          {forms && forms.length === 0 && (
            <div style={emptyBox}>
              <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No forms available</h3>
              <p style={{ color: 'var(--t-2)' }}>There are no query forms you can fill right now.</p>
            </div>
          )}
          {forms && forms.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {forms.map(f => (
                <button key={f.id} onClick={() => { setActive(f); setOkMsg(null); setError(null); }} style={formCard}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-deep)' }}>{f.title}</div>
                  {f.description && <div style={{ fontSize: 12, color: 'var(--t-2)', marginTop: 6, lineHeight: 1.45 }}>{f.description}</div>}
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--navy)', fontWeight: 700 }}>Fill →</div>
                </button>
              ))}
            </div>
          )}

          {mine.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 10 }}>My recent queries</div>
              <div style={cardBox}>
                {mine.slice(0, 12).map(q => (
                  <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid var(--line, #e7eaf0)', fontSize: 13 }}>
                    <span style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{q.formTitle || 'Query'}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: q.status === 'accepted' ? '#2E7D4F' : q.status === 'rejected' ? '#B5483D' : '#C98A14' }}>{q.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {active && (
        <FillForm
          form={active}
          onCancel={() => setActive(null)}
          onSaved={() => { setActive(null); setOkMsg('Query submitted — the accounts desk will pick it up.'); loadMine(); }}
          onError={setError}
        />
      )}
    </AppShell>
  );
}

function FillForm({ form, onCancel, onSaved, onError }: { form: Form; onCancel: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [values, setValues] = useState<Record<string, any>>({});
  // Per-field uploads (one File per 'file' field, keyed by field.key) plus the
  // catch-all "Attachments" slot at the bottom.
  const [fieldFiles, setFieldFiles] = useState<Record<string, File | null>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setValues(p => ({ ...p, [k]: v }));
  const setFile = (k: string, f: File | null) => setFieldFiles(p => ({ ...p, [k]: f }));

  // A 'file' field captures bytes (uploaded after create with kind=field.key),
  // not a text value — split it out from the text fields.
  const textFields = form.fields.filter(f => f.type !== 'file');
  const fileFields = form.fields.filter(f => f.type === 'file');

  // Files attach to whatever the submission became: a 'query' for a normal
  // form, or a 'vendor-payment' for a routed form (the create response tells
  // us which). The server's ownership fallback lets the submitter upload even
  // without the owning view's edit right.
  async function uploadOne(entityType: string, id: string, file: File, kind: string) {
    const fd = new FormData();
    fd.append('entityType', entityType);
    fd.append('entityId', id);
    fd.append('kind', kind);
    fd.append('file', file);
    const up = await fetch('/api/files', { method: 'POST', body: fd }).then(x => x.json()).catch(() => null);
    if (!up?.ok) onError(up?.error || `Failed to upload ${file.name}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const f of textFields) {
      if (f.required && !String(values[f.key] ?? '').trim()) { onError(`${f.label} is required.`); return; }
    }
    for (const f of fileFields) {
      if (f.required && !fieldFiles[f.key]) { onError(`${f.label} is required.`); return; }
    }
    setSaving(true);
    try {
      const res = await fetch('/api/queries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formKey: form.key, values }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Submit failed');
      // Normal forms return {query}, routed forms return {entityType,entityId}.
      const entityType: string = res?.data?.entityType || 'query';
      const id: string | undefined = res?.data?.entityId || res?.data?.query?.id;
      if (id) {
        for (const f of fileFields) {
          const file = fieldFiles[f.key];
          if (file) await uploadOne(entityType, id, file, f.key);
        }
        for (const file of files) await uploadOne(entityType, id, file, 'attachment');
      }
      onSaved();
    } catch (e: any) { onError(e.message); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: 20, maxWidth: 640 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--navy-deep)', marginBottom: 4 }}>{form.title}</div>
      {form.description && <div style={{ fontSize: 12.5, color: 'var(--t-2)', marginBottom: 16 }}>{form.description}</div>}

      <div style={{ display: 'grid', gap: 14 }}>
        {textFields.map(f => (
          <label key={f.key} style={{ display: 'block' }}>
            <span style={fieldLbl}>{f.label}{f.required ? ' *' : ''}</span>
            <FieldInput field={f} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} />
            {f.help && <span style={{ display: 'block', fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>{f.help}</span>}
          </label>
        ))}
        {fileFields.map(f => (
          <label key={f.key} style={{ display: 'block' }}>
            <span style={fieldLbl}>{f.label}{f.required ? ' *' : ''}</span>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.xlsx,.xls,.csv,.doc,.docx"
              onChange={e => setFile(f.key, e.target.files?.[0] || null)} style={{ ...inputStyle, padding: '7px 9px' }} />
            {fieldFiles[f.key] && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--t-2)', marginTop: 4 }}>{fieldFiles[f.key]!.name}</span>}
            {f.help && <span style={{ display: 'block', fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>{f.help}</span>}
          </label>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <span style={fieldLbl}>Other attachments (optional)</span>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.xlsx,.xls,.csv,.doc,.docx"
          onChange={e => setFiles(Array.from(e.target.files || []))} style={{ ...inputStyle, padding: '7px 9px' }} />
        {files.length > 0 && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--t-2)' }}>{files.length} file{files.length === 1 ? '' : 's'} ready to attach.</div>}
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <button type="submit" disabled={saving} style={addBtn}>{saving ? 'SUBMITTING…' : 'SUBMIT QUERY'}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>CANCEL</button>
      </div>
    </form>
  );
}

function FieldInput({ field, value, onChange }: { field: QueryField; value: any; onChange: (v: any) => void }) {
  if (field.type === 'textarea') return <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />;
  if (field.type === 'select') return (
    <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>
      <option value="">— select —</option>
      {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  if (field.type === 'number') return <input type="number" value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />;
  if (field.type === 'money') return <input type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} placeholder="0.00" style={inputStyle} />;
  if (field.type === 'date') return <input type="date" value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />;
  // text + account → plain text (accounts desk links the real account later)
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={field.type === 'account' ? 'Type the name' : ''} style={inputStyle} />;
}

const fieldLbl: React.CSSProperties = { display: 'block', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 5 };
const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff' };
const formCard: React.CSSProperties = { textAlign: 'left', background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: 16, cursor: 'pointer' };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(15,40,85,.18)' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: 'var(--t-2)', border: '1px solid var(--line-2, #d0d6e0)', borderRadius: 10, padding: '11px 18px', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', cursor: 'pointer' };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const okBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: '#2E7D4F', fontSize: 12.5, background: 'rgba(46,125,79,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
