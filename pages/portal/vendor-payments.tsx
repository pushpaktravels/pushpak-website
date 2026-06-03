// ============================================================
// /portal/vendor-payments — vendor-payment request ledger.
// ============================================================
// Replaces the vendor-payment Google Form + its response Excel. An employee
// RAISES a request against a vendor bill → a manager (Shashank/Raunak)
// REVIEWS and approves or rejects → once approved the payment is RECORDED →
// accounts mark it BILLED. Portal-only — nothing here talks to FinBook.
//
// The approve / reject / pay buttons only appear for manager roles; the API
// enforces the same state machine server-side, so the UI is convenience only.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR, fmtDate } from '../../lib/fmt';
import { VENDOR_STATUS_LABEL, VENDOR_STATUS_COLOR, PAYMENT_MODES } from '../../lib/vendorpay';

type Payment = {
  id: string; vendorName: string; billNo: string | null; amount: number | string;
  purpose: string | null; billDate: string | null; dueDate: string | null; department: string | null;
  status: string; requestedByName: string | null; reviewedByName: string | null; reviewNote: string | null;
  paymentMode: string | null; paymentRef: string | null; paidByName: string | null; paidAt: string | null;
  billedByName: string | null; notes: string | null; createdAt: string;
};
type Summary = { pending: number; pending_amount: number | string; approved_amount: number | string };

const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My requests' },
  { key: 'pending', label: 'Pending approval' },
];
// Which roles may approve / reject / record payment. Mirrors
// VENDOR_APPROVER_ROLES on the server (the API is the real gate).
const APPROVER_ROLES = new Set(['owner', 'admin', 'cm-accounts']);

export default function VendorPaymentsPage() {
  const [scope, setScope] = useState('all');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();

  const isApprover = me ? APPROVER_ROLES.has(me.role) : false;

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(r => { if (r?.ok && r.user) setMe({ role: r.user.role }); }).catch(() => {});
  }, []);

  function load() {
    const params = new URLSearchParams({ scope });
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    fetch(`/api/vendor-payments?${params.toString()}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.payments || []);
        setSummary(r.data.summary || null);
      })
      .catch(e => setError(e.message));
  }
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status, q]);

  async function act(p: Payment, action: 'approve' | 'reject' | 'pay' | 'bill') {
    let body: any = { action };
    if (action === 'reject') {
      const note = window.prompt('Reason for rejecting this request? (optional)') ?? '';
      body.reviewNote = note;
    }
    if (action === 'pay') {
      const mode = window.prompt(`How was it paid? (${PAYMENT_MODES.join(' / ')})`, 'bank');
      if (!mode) return;
      if (!PAYMENT_MODES.includes(mode.trim() as any)) { setError(`Payment mode must be one of: ${PAYMENT_MODES.join(', ')}`); return; }
      body.paymentMode = mode.trim();
      body.paymentRef = window.prompt('Reference / UTR / cheque no (optional)') ?? '';
    }
    if (action === 'approve') {
      const ok = await confirm({ title: `Approve payment to ${p.vendorName}?`, body: `${fmtINR(Number(p.amount))} will move to the "to pay" queue.`, confirmLabel: 'Approve' });
      if (!ok) return;
    }
    try {
      const res = await fetch(`/api/vendor-payments/${encodeURIComponent(p.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Update failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove(p: Payment) {
    const ok = await confirm({ title: 'Delete this request?', body: `Permanently removes the request to ${p.vendorName}.`, confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/vendor-payments/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Delete failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <AppShell title="Vendor Payments" crumb="Vendor Payments">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Vendor Payments</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            Raise a payment request against a vendor bill. A manager reviews and approves, the payment is recorded, then accounts mark it billed. (Portal-only — nothing here posts to FinBook yet.)
          </p>
        </div>
        <button onClick={() => setAdding(v => !v)} style={addBtn}>{adding ? 'CLOSE' : '+ RAISE REQUEST'}</button>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {adding && <AddForm onSaved={() => { setAdding(false); load(); }} onError={setError} />}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, margin: '4px 0 18px' }}>
        <div style={statCard}>
          <div style={statLabel}>Awaiting approval</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: summary && summary.pending > 0 ? '#C98A14' : 'var(--t-3)' }}>{summary ? summary.pending : '—'}</div>
          <div style={statSub}>{summary && Number(summary.pending_amount) > 0 ? fmtINR(Number(summary.pending_amount)) : 'nothing pending'}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Approved — to pay</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: summary && Number(summary.approved_amount) > 0 ? '#1A6FA8' : 'var(--t-3)' }}>{summary ? fmtINR(Number(summary.approved_amount)) : '—'}</div>
          <div style={statSub}>cleared, awaiting payment</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCOPES.map(s => <button key={s.key} onClick={() => setScope(s.key)} style={chip(scope === s.key)}>{s.label}</button>)}
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 200 }}>
          <option value="">All statuses</option>
          {Object.entries(VENDOR_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor, bill no, purpose…" style={{ ...inputStyle, maxWidth: 280 }} />
        <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12.5, color: 'var(--t-2)' }}>
          {rows ? `${rows.length} request${rows.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>Nothing here yet</h3>
          <p style={{ color: 'var(--t-2)' }}>Click <strong>+ Raise request</strong> to log a vendor bill that needs paying.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Vendor / Bill</Th><Th align="right">Amount</Th><Th>Purpose</Th><Th>Due</Th>
                <Th>Raised by</Th><Th>Status</Th><Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--line, #e7eaf0)', opacity: p.status === 'rejected' ? 0.6 : 1 }}>
                  <Td>
                    <div style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{p.vendorName}</div>
                    {p.billNo && <div style={{ fontSize: 10.5, color: 'var(--t-3)' }}>Bill {p.billNo}{p.billDate ? ` · ${fmtDate(p.billDate)}` : ''}</div>}
                  </Td>
                  <Td align="right"><strong>{fmtINR(Number(p.amount))}</strong></Td>
                  <Td><span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>{p.purpose || '—'}</span></Td>
                  <Td><span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>{p.dueDate ? fmtDate(p.dueDate) : '—'}</span></Td>
                  <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{p.requestedByName || '—'}</span></Td>
                  <Td>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: VENDOR_STATUS_COLOR[p.status] || 'var(--t-2)' }}>{VENDOR_STATUS_LABEL[p.status] || p.status}</span>
                    {p.status === 'paid' && p.paymentMode && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>{p.paymentMode}{p.paymentRef ? ` · ${p.paymentRef}` : ''}</div>}
                    {p.status === 'rejected' && p.reviewNote && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>“{p.reviewNote}”</div>}
                    {p.status === 'billed' && p.billedByName && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>by {p.billedByName}</div>}
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {isApprover && p.status === 'requested' && <RowBtn onClick={() => act(p, 'approve')}>Approve</RowBtn>}
                      {isApprover && p.status === 'requested' && <RowBtn onClick={() => act(p, 'reject')}>Reject</RowBtn>}
                      {isApprover && p.status === 'approved' && <RowBtn onClick={() => act(p, 'pay')}>Record payment</RowBtn>}
                      {p.status === 'paid' && <RowBtn onClick={() => act(p, 'bill')}>Mark billed</RowBtn>}
                      <RowBtn onClick={() => remove(p)}>Delete</RowBtn>
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

// ─── Raise-request form ───────────────────────────────────────
function AddForm({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({
    vendorName: '', billNo: '', amount: '', purpose: '',
    billDate: '', dueDate: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.vendorName.trim()) { onError('Enter the vendor name.'); return; }
    if (!f.amount || Number(f.amount) <= 0) { onError('Enter the bill amount.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/vendor-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f, amount: Number(f.amount),
          billDate: f.billDate ? new Date(f.billDate).toISOString() : null,
          dueDate: f.dueDate ? new Date(f.dueDate).toISOString() : null,
        }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Save failed');
      onSaved();
    } catch (e: any) { onError(e.message); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Vendor *"><input value={f.vendorName} onChange={e => set('vendorName', e.target.value)} placeholder="Vendor / supplier name" style={inputStyle} /></Field>
        <Field label="Bill no"><input value={f.billNo} onChange={e => set('billNo', e.target.value)} placeholder="Invoice / bill number" style={inputStyle} /></Field>
        <Field label="Amount *"><input type="number" min="0" step="0.01" value={f.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" style={inputStyle} /></Field>
        <Field label="Bill date"><input type="date" value={f.billDate} onChange={e => set('billDate', e.target.value)} style={inputStyle} /></Field>
        <Field label="Due date"><input type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} style={inputStyle} /></Field>
        <Field label="Purpose"><input value={f.purpose} onChange={e => set('purpose', e.target.value)} placeholder="What is this payment for" style={inputStyle} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything to flag for the approver" style={inputStyle} /></Field>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <button type="submit" disabled={saving} style={addBtn}>{saving ? 'SAVING…' : 'RAISE REQUEST'}</button>
      </div>
    </form>
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

const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, border: active ? '1px solid var(--navy-deep, #1A3F7E)' : '1px solid rgba(15,40,85,0.2)', background: active ? 'var(--navy-deep, #1A3F7E)' : '#fff', color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff' };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(15,40,85,.18)' };
const statCard: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: '12px 14px' };
const statLabel: React.CSSProperties = { fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 };
const statSub: React.CSSProperties = { fontSize: 11, color: 'var(--t-3)', marginTop: 2 };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
