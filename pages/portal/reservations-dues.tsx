// ============================================================
// /portal/reservations-dues — bookings with an outstanding balance.
// ============================================================
// Lists every non-cancelled booking where fare > collected, soonest
// travel date first. "Record payment" opens the shared modal so the
// agent can update the collected amount (and flip to Ticketed).
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtINR, fmtDate } from '../../lib/fmt';
import { ReservationModal, StatusPill, due, type Reservation } from '../../components/ReservationModal';

export default function ReservationDuesPage() {
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Reservation | null>(null);

  function load() {
    fetch('/api/reservations?scope=dues')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.reservations || []);
      })
      .catch(e => setError(e.message));
  }
  useEffect(load, []);

  const totalDue = (rows || []).reduce((s, r) => s + due(r), 0);
  const totalFare = (rows || []).reduce((s, r) => s + Number(r.fareAmount || 0), 0);

  return (
    <AppShell title="Payment Dues" crumb="Domestic Reservations">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Payment Dues</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55, maxWidth: 720 }}>
          Bookings with money still to collect. Record a payment to update the balance, or mark the booking ticketed once it's cleared.
        </p>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {/* Summary cards */}
      {rows && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Stat label="Bookings with dues" value={String(rows.length)} />
          <Stat label="Total fare" value={fmtINR(totalFare)} />
          <Stat label="Outstanding" value={fmtINR(totalDue)} tone="rust" />
        </div>
      )}

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}

      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>All clear</h3>
          <p style={{ color: 'var(--t-2)' }}>No bookings have an outstanding balance right now.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Passenger</Th><Th>Sector</Th><Th>Travel</Th>
                <Th align="right">Fare</Th><Th align="right">Collected</Th><Th align="right">Due</Th>
                <Th>Status</Th><Th>Agent</Th><Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const d = due(r);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Td>
                      <strong style={{ color: 'var(--navy-deep)' }}>{r.passengerName}</strong>
                      {r.contact && <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>{r.contact}</div>}
                    </Td>
                    <Td>{r.sector}</Td>
                    <Td>{r.travelDate ? fmtDate(r.travelDate) : '—'}</Td>
                    <Td align="right" mono>{fmtINR(Number(r.fareAmount))}</Td>
                    <Td align="right" mono>{fmtINR(Number(r.amountCollected))}</Td>
                    <Td align="right" mono><span style={{ color: 'var(--rust)', fontWeight: 700 }}>{fmtINR(d)}</span></Td>
                    <Td><StatusPill status={r.status} /></Td>
                    <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{r.agentName || '—'}</span></Td>
                    <Td align="right"><RowBtn onClick={() => setEdit(r)}>Record payment</RowBtn></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <ReservationModal
          mode="edit"
          reservation={edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
    </AppShell>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rust' }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12,
      padding: '14px 18px', minWidth: 160,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color: tone === 'rust' ? 'var(--rust, #B5483D)' : 'var(--navy-deep)' }}>{value}</div>
    </div>
  );
}
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '12px 16px', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return <td style={{ textAlign: align || 'left', padding: '12px 16px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? 'inherit' : undefined }}>{children}</td>;
}
function RowBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: '#fff', color: 'var(--t-2)', border: '1px solid var(--line-2, #d0d6e0)', borderRadius: 6,
      padding: '6px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', cursor: 'pointer',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--navy)'; e.currentTarget.style.color = 'var(--navy)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2, #d0d6e0)'; e.currentTarget.style.color = 'var(--t-2)'; }}>
      {children}
    </button>
  );
}
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
