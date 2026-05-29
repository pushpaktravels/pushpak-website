// ============================================================
// /portal/reservations — Domestic Reservations: bookings list.
// ============================================================
// Master list of every domestic booking with search + status
// filter, a "+ New booking" button, and per-row Edit / Delete.
// New & Edit both open the shared ReservationModal.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR, fmtDate } from '../../lib/fmt';
import { ReservationModal, StatusPill, due, RES_STATUSES, type Reservation } from '../../components/ReservationModal';

export default function ReservationsPage() {
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<Reservation | 'new' | null>(null);
  const confirm = useConfirm();

  function load() {
    const params = new URLSearchParams({ scope: 'all' });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    fetch(`/api/reservations?${params.toString()}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.reservations || []);
      })
      .catch(e => setError(e.message));
  }
  // Debounced reload on filter change.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

  async function remove(r: Reservation) {
    const ok = await confirm({
      title: `Delete booking for ${r.passengerName}?`,
      body: 'This permanently removes the reservation record.',
      confirmLabel: 'Delete', destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(r.id)}`, { method: 'DELETE' }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Delete failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  const totalDue = (rows || []).reduce((s, r) => s + due(r), 0);

  return (
    <AppShell title="Reservations" crumb="Domestic Reservations">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Reservations</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            Every domestic booking — passenger, route, fare and payment status. Log a new booking or edit any existing one.
          </p>
        </div>
        <button onClick={() => setEdit('new')} style={addBtn}>+ NEW BOOKING</button>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search passenger, PNR, sector, airline…"
          style={{ ...inputStyle, maxWidth: 320 }}
        />
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="">All statuses</option>
          {RES_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12.5, color: 'var(--t-2)' }}>
          {rows ? `${rows.length} booking${rows.length === 1 ? '' : 's'}` : ''}{totalDue > 0 ? ` · ${fmtINR(totalDue)} due` : ''}
        </div>
      </div>

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}

      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No bookings yet</h3>
          <p style={{ color: 'var(--t-2)' }}>Click <strong>+ New booking</strong> to log the first reservation.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Passenger</Th><Th>Sector</Th><Th>Travel</Th><Th>Airline</Th>
                <Th align="right">Fare</Th><Th align="right">Due</Th><Th>Status</Th><Th>Agent</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const d = due(r);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Td>
                      <strong style={{ color: 'var(--navy-deep)' }}>{r.passengerName}</strong>
                      {r.paxCount > 1 && <span style={{ fontSize: 11, color: 'var(--t-3)' }}> +{r.paxCount - 1}</span>}
                      {r.pnr && <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>PNR {r.pnr}</div>}
                    </Td>
                    <Td>{r.sector}</Td>
                    <Td>{r.travelDate ? fmtDate(r.travelDate) : '—'}</Td>
                    <Td>{r.airline || '—'}</Td>
                    <Td align="right" mono>{fmtINR(Number(r.fareAmount))}</Td>
                    <Td align="right" mono>
                      <span style={{ color: d > 0 ? 'var(--rust)' : 'var(--sage)', fontWeight: d > 0 ? 700 : 400 }}>
                        {d > 0 ? fmtINR(d) : '—'}
                      </span>
                    </Td>
                    <Td><StatusPill status={r.status} /></Td>
                    <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{r.agentName || '—'}</span></Td>
                    <Td align="right">
                      <div style={{ display: 'inline-flex', gap: 8 }}>
                        <RowBtn onClick={() => setEdit(r)}>Edit</RowBtn>
                        <RowBtn onClick={() => remove(r)}>Delete</RowBtn>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <ReservationModal
          mode={edit === 'new' ? 'create' : 'edit'}
          reservation={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
    </AppShell>
  );
}

// ─── bits ─────────────────────────────────────────────────────
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
const addBtn: React.CSSProperties = {
  background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px',
  fontSize: 12, fontWeight: 700, letterSpacing: '.16em', cursor: 'pointer', whiteSpace: 'nowrap',
  boxShadow: '0 4px 14px rgba(15,40,85,.18)',
};
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '10px 12px', border: '1px solid var(--line, #e7eaf0)',
  borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff',
};
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
