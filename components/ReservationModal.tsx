// ============================================================
// ReservationModal — create / edit a domestic booking.
// ============================================================
// Shared by /portal/reservations (list), /reservations-dues, and
// /reservations-worklist so the form lives in exactly one place.
// Also exports the Reservation type, a StatusPill, and the `due`
// helper used across all three pages.
// ============================================================
import { useState } from 'react';
import { ClientPicker } from './ClientPicker';
import { VendorPicker } from './VendorPicker';
import { AirlineInput } from './AirlineInput';

export type Reservation = {
  id: string;
  pnr: string | null;
  party: string | null;
  passengerName: string;
  paxCount: number;
  contact: string | null;
  sector: string;
  airline: string | null;
  travelDate: string | null;
  fareAmount: string | number;
  amountCollected: string | number;
  costAmount: string | number;
  refundAmount: string | number;
  holdUntil: string | null;
  vendor: string | null;
  status: 'Held' | 'Ticketed' | 'Cancelled';
  notes: string | null;
  agentExecId: string | null;
  agentName: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const RES_STATUSES = ['Held', 'Ticketed', 'Cancelled'] as const;

export function due(r: Pick<Reservation, 'fareAmount' | 'amountCollected'>): number {
  return Math.max(0, Number(r.fareAmount || 0) - Number(r.amountCollected || 0));
}

const STATUS_META: Record<string, { bg: string; fg: string }> = {
  Held:      { bg: 'rgba(217,165,69,.18)', fg: '#B58430' },
  Ticketed:  { bg: 'rgba(46,108,84,.14)',  fg: '#2E6C54' },
  Cancelled: { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_META[status] || { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' };
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700,
      letterSpacing: '.12em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 6,
    }}>{status}</span>
  );
}

// HTML <input type="date"> wants YYYY-MM-DD; the API returns ISO.
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// HTML <input type="datetime-local"> wants YYYY-MM-DDTHH:mm in LOCAL time.
function toDateTimeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function ReservationModal({
  mode, reservation, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  reservation: Reservation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const r = reservation;
  const [party, setParty]                 = useState(r?.party || '');
  const [passengerName, setPassengerName] = useState(r?.passengerName || '');
  const [paxCount, setPaxCount]           = useState(String(r?.paxCount ?? 1));
  const [contact, setContact]             = useState(r?.contact || '');
  const [sector, setSector]               = useState(r?.sector || '');
  const [airline, setAirline]             = useState(r?.airline || '');
  const [travelDate, setTravelDate]       = useState(toDateInput(r?.travelDate || null));
  const [fareAmount, setFareAmount]       = useState(r ? String(r.fareAmount ?? '') : '');
  const [amountCollected, setAmountCollected] = useState(r ? String(r.amountCollected ?? '') : '');
  const [costAmount, setCostAmount]       = useState(r ? String(r.costAmount ?? '') : '');
  const [refundAmount, setRefundAmount]   = useState(r ? String(r.refundAmount ?? '') : '');
  const [holdUntil, setHoldUntil]         = useState(toDateTimeInput(r?.holdUntil || null));
  const [vendor, setVendor]               = useState(r?.vendor || '');
  const [pnr, setPnr]                     = useState(r?.pnr || '');
  const [status, setStatus]               = useState<Reservation['status']>(r?.status || 'Held');
  const [notes, setNotes]                 = useState(r?.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!passengerName.trim()) { setErr('Passenger name is required'); return; }
    if (!sector.trim())        { setErr('Sector / route is required'); return; }
    const fare = Number(fareAmount || 0);
    const coll = Number(amountCollected || 0);
    if (coll > fare) { setErr('Collected amount cannot exceed the fare'); return; }

    setSaving(true);
    const payload = {
      party: party.trim() || null,
      passengerName: passengerName.trim(),
      paxCount: Number(paxCount || 1),
      contact: contact.trim() || null,
      sector: sector.trim(),
      airline: airline.trim() || null,
      travelDate: travelDate || null,
      fareAmount: fare,
      amountCollected: coll,
      costAmount: Number(costAmount || 0),
      refundAmount: Number(refundAmount || 0),
      holdUntil: status === 'Held' ? (holdUntil || null) : null,
      vendor: vendor.trim() || null,
      pnr: pnr.trim() || null,
      status,
      notes: notes.trim() || null,
    };
    try {
      const res = mode === 'create'
        ? await fetch('/api/reservations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).then(x => x.json())
        : await fetch(`/api/reservations/${encodeURIComponent(r!.id)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Save failed');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }

  const fareN = Number(fareAmount || 0);
  const collN = Number(amountCollected || 0);
  const costN = Number(costAmount || 0);
  const dueN = Math.max(0, fareN - collN);
  const marginN = fareN - costN;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,24,58,.55)', zIndex: 200 }} />
      <div role="dialog" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(620px, 94vw)', maxHeight: '90vh',
        background: '#fff', borderRadius: 14, boxShadow: '0 30px 80px rgba(8,24,58,.35)',
        zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <header style={{
          padding: '20px 24px', borderBottom: '1px solid var(--line, #e7eaf0)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--navy-deep)' }}>
            {mode === 'create' ? 'New booking' : <>Edit booking · <span style={{ fontWeight: 700 }}>{r!.passengerName}</span></>}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, color: 'var(--t-2)', lineHeight: 1, padding: 0 }}>×</button>
        </header>

        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          <SectionLabel>Client &amp; passenger</SectionLabel>
          <Field label="Billed to (account)">
            <ClientPicker value={party} onChange={setParty} inputStyle={inputStyle} placeholder="Search the client / account being billed…" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
            <Field label="Passenger name">
              <input value={passengerName} onChange={e => setPassengerName(e.target.value)} style={inputStyle} placeholder="who is travelling" />
            </Field>
            <Field label="Pax">
              <input type="number" min={1} value={paxCount} onChange={e => setPaxCount(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <Field label="Contact (phone / email)">
            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="optional" style={inputStyle} />
          </Field>

          <hr style={divStyle} />
          <SectionLabel>Itinerary</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Sector / route">
              <input value={sector} onChange={e => setSector(e.target.value)} placeholder="e.g. GAU-DEL" style={inputStyle} />
            </Field>
            <Field label="Airline">
              <AirlineInput value={airline} onChange={setAirline} inputStyle={inputStyle} />
            </Field>
            <Field label="Travel date">
              <input type="date" value={travelDate} onChange={e => setTravelDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="PNR">
              <input value={pnr} onChange={e => setPnr(e.target.value.toUpperCase())} placeholder="locator" style={inputStyle} />
            </Field>
          </div>

          <hr style={divStyle} />
          <SectionLabel>Money</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Fare (₹)">
              <input type="number" min={0} value={fareAmount} onChange={e => setFareAmount(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Collected (₹)">
              <input type="number" min={0} value={amountCollected} onChange={e => setAmountCollected(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Vendor cost (₹)">
              <input type="number" min={0} value={costAmount} onChange={e => setCostAmount(e.target.value)} placeholder="what we pay the vendor" style={inputStyle} />
            </Field>
            {status === 'Cancelled' && (
              <Field label="Refund to client (₹)">
                <input type="number" min={0} value={refundAmount} onChange={e => setRefundAmount(e.target.value)} style={inputStyle} />
              </Field>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
            <div style={{
              flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', borderRadius: 8,
              background: dueN > 0 ? 'rgba(181,72,61,.07)' : 'rgba(46,108,84,.08)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--t-2)', fontWeight: 600 }}>Balance due</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: dueN > 0 ? 'var(--rust, #B5483D)' : 'var(--sage, #2E6C54)' }}>
                ₹{dueN.toLocaleString('en-IN')}
              </span>
            </div>
            <div style={{
              flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', borderRadius: 8,
              background: marginN < 0 ? 'rgba(181,72,61,.07)' : 'rgba(46,108,84,.08)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--t-2)', fontWeight: 600 }}>Margin</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: marginN < 0 ? 'var(--rust, #B5483D)' : 'var(--sage, #2E6C54)' }}>
                ₹{marginN.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          <Field label="Vendor">
            <VendorPicker value={vendor} onChange={setVendor} inputStyle={inputStyle} placeholder="optional — search supplier…" />
          </Field>

          <hr style={divStyle} />
          <SectionLabel>Status</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Booking status">
              <select value={status} onChange={e => setStatus(e.target.value as Reservation['status'])} style={inputStyle}>
                {RES_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            {status === 'Held' && (
              <Field label="Hold until (ticketing deadline)">
                <input type="datetime-local" value={holdUntil} onChange={e => setHoldUntil(e.target.value)} style={inputStyle} />
              </Field>
            )}
          </div>
          {status === 'Held' && (
            <div style={{ fontSize: 11.5, color: 'var(--t-2)', margin: '-4px 0 12px', lineHeight: 1.5 }}>
              Setting a deadline drops an <strong>urgent hold-clock reminder</strong> into your Tasks — it clears automatically once you ticket or cancel.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
            <Field label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                style={{ ...inputStyle, resize: 'vertical' }} placeholder="optional" />
            </Field>
          </div>

          {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>

        <footer style={{
          padding: '14px 24px', borderTop: '1px solid var(--line, #e7eaf0)',
          background: 'var(--bg-2, #f6f8fb)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} disabled={saving} style={btnGhost}>CANCEL</button>
          <button onClick={save} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'SAVING…' : mode === 'create' ? 'CREATE BOOKING' : 'SAVE CHANGES'}
          </button>
        </footer>
      </div>
    </>
  );
}

// ─── shared bits ──────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: '.26em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 12 }}>{children}</div>;
}
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '10px 12px',
  border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
  outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff',
};
const divStyle: React.CSSProperties = { border: 'none', borderTop: '1px solid var(--line, #e7eaf0)', margin: '18px 0' };
const btnGhost: React.CSSProperties = {
  background: 'transparent', color: 'var(--t-2)', border: '1px solid var(--line, #e7eaf0)',
  borderRadius: 8, padding: '10px 20px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  background: 'var(--navy-deep)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '10px 22px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em',
};
