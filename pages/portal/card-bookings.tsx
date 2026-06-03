// ============================================================
// /portal/card-bookings — Credit-card booking log.
// ============================================================
// Replaces the OTP Google Form + the response Excel that Nigar billed from.
// A booker logs each card payment here right after booking; accounts work
// the "Unbilled" tab and mark each one billed once invoiced. Portal-only —
// nothing here talks to FinBook.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR, fmtDate } from '../../lib/fmt';
import { CARDS, CARD_LABEL, CARD_PURPOSES } from '../../lib/cards';

type Booking = {
  id: string; cardKey: string; amount: number | string; purpose: string;
  passengerName: string | null; pnr: string | null; airline: string | null;
  clientName: string | null; department: string | null; txnDate: string;
  status: string; bookedByName: string | null; billedByName: string | null; billedAt: string | null;
  notes: string | null;
};
type UnbilledTotal = { cardKey: string; n: number; total: number | string };

const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My entries' },
  { key: 'unbilled', label: 'Unbilled' },
];
const STATUS_COLOR: Record<string, string> = { unbilled: '#C98A14', billed: '#2E7D4F', cancelled: '#8a8f99' };

export default function CardBookingsPage() {
  const [scope, setScope] = useState('all');
  const [card, setCard] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [unbilled, setUnbilled] = useState<UnbilledTotal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();

  function load() {
    const params = new URLSearchParams({ scope });
    if (card) params.set('card', card);
    if (q.trim()) params.set('q', q.trim());
    fetch(`/api/card-bookings?${params.toString()}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.bookings || []);
        setUnbilled(r.data.unbilledByCard || []);
      })
      .catch(e => setError(e.message));
  }
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, card, q]);

  async function act(b: Booking, action: 'bill' | 'unbill' | 'cancel') {
    if (action === 'cancel') {
      const ok = await confirm({ title: 'Cancel this card entry?', body: 'Marks it cancelled (not billable). It stays in the log.', confirmLabel: 'Cancel entry', destructive: true });
      if (!ok) return;
    }
    try {
      const res = await fetch(`/api/card-bookings/${encodeURIComponent(b.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Update failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove(b: Booking) {
    const ok = await confirm({ title: 'Delete this card entry?', body: 'Permanently removes the log row.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/card-bookings/${encodeURIComponent(b.id)}`, { method: 'DELETE' }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Delete failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  const totalUnbilled = unbilled.reduce((s, u) => s + Number(u.total), 0);

  return (
    <AppShell title="Card Bookings" crumb="Card Bookings">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Card Bookings</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            Log every credit-card payment right after booking — which card, how much, what for. Accounts works the <strong>Unbilled</strong> tab and marks each one billed. (No OTP or card number is stored.)
          </p>
        </div>
        <button onClick={() => setAdding(v => !v)} style={addBtn}>{adding ? 'CLOSE' : '+ LOG CARD PAYMENT'}</button>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {adding && <AddForm onSaved={() => { setAdding(false); load(); }} onError={setError} />}

      {/* Unbilled-per-card summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '4px 0 18px' }}>
        {CARDS.map(c => {
          const u = unbilled.find(x => x.cardKey === c.key);
          return (
            <div key={c.key} style={statCard}>
              <div style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: u && Number(u.total) > 0 ? '#C98A14' : 'var(--t-3)' }}>
                {u ? fmtINR(Number(u.total)) : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>{u ? `${u.n} unbilled` : 'nothing unbilled'}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCOPES.map(s => <button key={s.key} onClick={() => setScope(s.key)} style={chip(scope === s.key)}>{s.label}</button>)}
        <select value={card} onChange={e => setCard(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }}>
          <option value="">All cards</option>
          {CARDS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search passenger, PNR, client…" style={{ ...inputStyle, maxWidth: 280 }} />
        <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12.5, color: 'var(--t-2)' }}>
          {rows ? `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}` : ''}{totalUnbilled > 0 ? ` · ${fmtINR(totalUnbilled)} unbilled` : ''}
        </div>
      </div>

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>Nothing here yet</h3>
          <p style={{ color: 'var(--t-2)' }}>Click <strong>+ Log card payment</strong> after a card booking to record it.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Date</Th><Th>Card</Th><Th align="right">Amount</Th><Th>For</Th><Th>Passenger / PNR</Th>
                <Th>Client</Th><Th>Logged by</Th><Th>Status</Th><Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--line, #e7eaf0)', opacity: b.status === 'cancelled' ? 0.55 : 1 }}>
                  <Td>{fmtDate(b.txnDate)}</Td>
                  <Td><span style={{ fontSize: 12 }}>{CARD_LABEL[b.cardKey] || b.cardKey}</span></Td>
                  <Td align="right" ><strong>{fmtINR(Number(b.amount))}</strong></Td>
                  <Td><span style={{ textTransform: 'capitalize' }}>{b.purpose}</span></Td>
                  <Td>
                    <div style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{b.passengerName || '—'}</div>
                    {b.pnr && <div style={{ fontSize: 10.5, color: 'var(--t-3)' }}>PNR {b.pnr}{b.airline ? ` · ${b.airline}` : ''}</div>}
                  </Td>
                  <Td><span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>{b.clientName || '—'}</span></Td>
                  <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{b.bookedByName || '—'}</span></Td>
                  <Td>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: STATUS_COLOR[b.status] || 'var(--t-2)' }}>{b.status}</span>
                    {b.status === 'billed' && b.billedByName && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>by {b.billedByName}</div>}
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {b.status === 'unbilled' && <RowBtn onClick={() => act(b, 'bill')}>Mark billed</RowBtn>}
                      {b.status === 'billed' && <RowBtn onClick={() => act(b, 'unbill')}>Undo</RowBtn>}
                      {b.status !== 'cancelled' && <RowBtn onClick={() => act(b, 'cancel')}>Cancel</RowBtn>}
                      <RowBtn onClick={() => remove(b)}>Delete</RowBtn>
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
  const [f, setF] = useState({
    cardKey: CARDS[0].key, amount: '', purpose: 'ticket', passengerName: '',
    pnr: '', airline: '', clientName: '', txnDate: new Date().toISOString().slice(0, 10), notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.amount || Number(f.amount) <= 0) { onError('Enter the amount charged to the card.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/card-bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, amount: Number(f.amount), txnDate: new Date(f.txnDate).toISOString() }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Save failed');
      onSaved();
    } catch (e: any) { onError(e.message); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Card *"><select value={f.cardKey} onChange={e => set('cardKey', e.target.value)} style={inputStyle}>{CARDS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
        <Field label="Amount *"><input type="number" min="0" step="0.01" value={f.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" style={inputStyle} /></Field>
        <Field label="For"><select value={f.purpose} onChange={e => set('purpose', e.target.value)} style={inputStyle}>{CARD_PURPOSES.map(p => <option key={p} value={p} style={{ textTransform: 'capitalize' }}>{p}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.txnDate} onChange={e => set('txnDate', e.target.value)} style={inputStyle} /></Field>
        <Field label="Passenger"><input value={f.passengerName} onChange={e => set('passengerName', e.target.value)} placeholder="Passenger name" style={inputStyle} /></Field>
        <Field label="PNR"><input value={f.pnr} onChange={e => set('pnr', e.target.value)} placeholder="PNR" style={inputStyle} /></Field>
        <Field label="Airline"><input value={f.airline} onChange={e => set('airline', e.target.value)} placeholder="Airline" style={inputStyle} /></Field>
        <Field label="Client"><input value={f.clientName} onChange={e => set('clientName', e.target.value)} placeholder="Client / company" style={inputStyle} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything to flag" style={inputStyle} /></Field>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <button type="submit" disabled={saving} style={addBtn}>{saving ? 'SAVING…' : 'SAVE ENTRY'}</button>
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
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
