// ============================================================
// /portal/vendors — the vendor/supplier master admin.
// ============================================================
// The "preferred tab to search vendors" (item #5): one searchable list behind
// every vendor picker (bookings, vendor payments). Add a new supplier, edit
// its contact / GSTIN / notes, or deactivate one you no longer use (kept, not
// deleted, so existing bills/bookings still resolve). Portal-only — nothing
// here touches FinBook. Gated on the 'vendors' view (accounts desk + owner).
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import type { Vendor } from '../../lib/vendors';

export default function VendorsPage() {
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [rows, setRows] = useState<Vendor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const confirm = useConfirm();

  function load() {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (showInactive) params.set('all', '1');
    fetch(`/api/vendors?${params.toString()}`)
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed to load'); setRows(r.vendors || []); })
      .catch(e => setError(e.message));
  }
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, showInactive]);

  async function patch(v: Vendor, body: Partial<Vendor>) {
    try {
      const res = await fetch(`/api/vendors/${encodeURIComponent(v.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Update failed');
      setEditId(null);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function toggleActive(v: Vendor) {
    if (v.active) {
      const ok = await confirm({ title: `Deactivate “${v.name}”?`, body: 'It will drop out of the pickers but stays linked to existing bills/bookings. You can re-activate it anytime.', confirmLabel: 'Deactivate' });
      if (!ok) return;
    }
    patch(v, { active: !v.active });
  }

  const count = rows?.length ?? 0;

  return (
    <AppShell title="Vendors" crumb="Vendors">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Vendors</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            The one supplier list behind every vendor picker. Add a new supplier here once and it’s instantly searchable on bookings and vendor payments. Deactivate (don’t delete) ones you’ve stopped using.
          </p>
        </div>
        <button onClick={() => setAdding(v => !v)} style={addBtn}>{adding ? 'CLOSE' : '+ ADD VENDOR'}</button>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {adding && <AddForm onSaved={() => { setAdding(false); load(); }} onError={setError} />}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor name…" style={{ ...inputStyle, maxWidth: 320 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--t-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12.5, color: 'var(--t-2)' }}>
          {rows ? `${count} vendor${count === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No vendors{q ? ` match “${q}”` : ' yet'}</h3>
          <p style={{ color: 'var(--t-2)' }}>Click <strong>+ Add vendor</strong> to grow the master.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Vendor</Th><Th>Contact</Th><Th>GSTIN</Th><Th>Notes</Th><Th>Status</Th><Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(v => editId === v.id
                ? <EditRow key={v.id} v={v} onCancel={() => setEditId(null)} onSave={(body) => patch(v, body)} />
                : (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--line, #e7eaf0)', opacity: v.active ? 1 : 0.5 }}>
                    <Td><span style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{v.name}</span></Td>
                    <Td>{v.contact || '—'}</Td>
                    <Td>{v.gstin || '—'}</Td>
                    <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{v.notes || '—'}</span></Td>
                    <Td>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: v.active ? '#2E7D4F' : '#8a8f99' }}>
                        {v.active ? 'active' : 'inactive'}
                      </span>
                    </Td>
                    <Td align="right">
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <RowBtn onClick={() => setEditId(v.id)}>Edit</RowBtn>
                        <RowBtn onClick={() => toggleActive(v)}>{v.active ? 'Deactivate' : 'Reactivate'}</RowBtn>
                      </div>
                    </Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ─── Add form ─────────────────────────────────────────────────
function AddForm({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ name: '', contact: '', gstin: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { onError('Vendor name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Save failed');
      onSaved();
    } catch (e: any) { onError(e.message); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Vendor name *"><input value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. AIRTEL" style={inputStyle} autoFocus /></Field>
        <Field label="Contact"><input value={f.contact} onChange={e => set('contact', e.target.value)} placeholder="phone / email / person" style={inputStyle} /></Field>
        <Field label="GSTIN"><input value={f.gstin} onChange={e => set('gstin', e.target.value)} placeholder="optional" style={inputStyle} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="anything to flag" style={inputStyle} /></Field>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <button type="submit" disabled={saving} style={addBtn}>{saving ? 'SAVING…' : 'SAVE VENDOR'}</button>
      </div>
    </form>
  );
}

// ─── Inline edit row ──────────────────────────────────────────
function EditRow({ v, onCancel, onSave }: { v: Vendor; onCancel: () => void; onSave: (body: Partial<Vendor>) => void }) {
  const [f, setF] = useState({ name: v.name, contact: v.contact || '', gstin: v.gstin || '', notes: v.notes || '' });
  const set = (k: string, val: string) => setF(p => ({ ...p, [k]: val }));
  return (
    <tr style={{ borderBottom: '1px solid var(--line, #e7eaf0)', background: 'var(--bg-2, #f6f8fb)' }}>
      <Td><input value={f.name} onChange={e => set('name', e.target.value)} style={{ ...inputStyle, padding: '6px 8px' }} /></Td>
      <Td><input value={f.contact} onChange={e => set('contact', e.target.value)} style={{ ...inputStyle, padding: '6px 8px' }} /></Td>
      <Td><input value={f.gstin} onChange={e => set('gstin', e.target.value)} style={{ ...inputStyle, padding: '6px 8px' }} /></Td>
      <Td><input value={f.notes} onChange={e => set('notes', e.target.value)} style={{ ...inputStyle, padding: '6px 8px' }} /></Td>
      <Td>—</Td>
      <Td align="right">
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <RowBtn onClick={() => onSave({ name: f.name.trim(), contact: f.contact.trim() || null, gstin: f.gstin.trim() || null, notes: f.notes.trim() || null })}>Save</RowBtn>
          <RowBtn onClick={onCancel}>Cancel</RowBtn>
        </div>
      </Td>
    </tr>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '11px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ textAlign: align || 'left', padding: '10px 14px', color: 'var(--t-1)', verticalAlign: 'middle' }}>{children}</td>;
}
function RowBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: '#fff', color: 'var(--t-2)', border: '1px solid var(--line-2, #d0d6e0)', borderRadius: 6, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--navy)'; e.currentTarget.style.color = 'var(--navy)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2, #d0d6e0)'; e.currentTarget.style.color = 'var(--t-2)'; }}>
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff' };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(15,40,85,.18)' };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
