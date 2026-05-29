// ============================================================
// /portal/reservations-worklist — "My Worklist" daily view.
// ============================================================
// The agent's own active bookings (scope=mine), grouped by what
// still needs doing: issue the ticket, collect the balance, or
// just keep an eye on an upcoming departure. Soonest travel first.
// Every row opens the shared modal so the agent can act in place.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtINR, fmtDate } from '../../lib/fmt';
import { ReservationModal, StatusPill, due, type Reservation } from '../../components/ReservationModal';

// Days from today to the travel date (null when no date / invalid).
function daysToTravel(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// A short, human label + tone for the travel proximity.
function travelTag(iso: string | null): { text: string; tone: 'rust' | 'amber' | 'muted' } | null {
  const n = daysToTravel(iso);
  if (n === null) return null;
  if (n < 0) return { text: `${Math.abs(n)}d ago`, tone: 'muted' };
  if (n === 0) return { text: 'Today', tone: 'rust' };
  if (n === 1) return { text: 'Tomorrow', tone: 'rust' };
  if (n <= 7) return { text: `In ${n}d`, tone: 'amber' };
  return { text: `In ${n}d`, tone: 'muted' };
}

export default function ReservationWorklistPage() {
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Reservation | null>(null);

  function load() {
    fetch('/api/reservations?scope=mine')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.reservations || []);
      })
      .catch(e => setError(e.message));
  }
  useEffect(load, []);

  // Split into "needs action" (held → ticket, or balance due) vs "on track".
  const needsAction = (rows || []).filter(r => r.status === 'Held' || due(r) > 0);
  const onTrack = (rows || []).filter(r => !(r.status === 'Held' || due(r) > 0));

  const heldCount = (rows || []).filter(r => r.status === 'Held').length;
  const dueCount = (rows || []).filter(r => due(r) > 0).length;
  const totalDue = (rows || []).reduce((s, r) => s + due(r), 0);

  return (
    <AppShell title="My Worklist" crumb="Domestic Reservations">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>My Worklist</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55, maxWidth: 720 }}>
          Your active bookings, soonest departure first. Anything still held or carrying a balance sits up top — open a row to issue the ticket or record a payment.
        </p>
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {/* Summary cards */}
      {rows && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Stat label="My active bookings" value={String(rows.length)} />
          <Stat label="Need ticketing" value={String(heldCount)} tone={heldCount > 0 ? 'amber' : undefined} />
          <Stat label="Awaiting payment" value={String(dueCount)} tone={dueCount > 0 ? 'rust' : undefined} />
          <Stat label="To collect" value={fmtINR(totalDue)} tone={totalDue > 0 ? 'rust' : undefined} />
        </div>
      )}

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}

      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>Nothing on your plate</h3>
          <p style={{ color: 'var(--t-2)' }}>You have no active bookings assigned to you right now.</p>
        </div>
      )}

      {rows && needsAction.length > 0 && (
        <Group title="Action required" count={needsAction.length} tone="rust">
          <WorklistTable rows={needsAction} onEdit={setEdit} />
        </Group>
      )}

      {rows && onTrack.length > 0 && (
        <Group title="On track" count={onTrack.length}>
          <WorklistTable rows={onTrack} onEdit={setEdit} muted />
        </Group>
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

// ─── table ────────────────────────────────────────────────────
function WorklistTable({ rows, onEdit, muted }: { rows: Reservation[]; onEdit: (r: Reservation) => void; muted?: boolean }) {
  return (
    <div style={cardBox}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
            <Th>Passenger</Th><Th>Sector</Th><Th>Travel</Th>
            <Th align="right">Fare</Th><Th align="right">Due</Th>
            <Th>To do</Th><Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const d = due(r);
            const tag = travelTag(r.travelDate);
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Td>
                  <strong style={{ color: 'var(--navy-deep)' }}>{r.passengerName}</strong>
                  {r.paxCount > 1 && <span style={{ fontSize: 11, color: 'var(--t-3)' }}> +{r.paxCount - 1}</span>}
                  {r.pnr && <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>PNR {r.pnr}</div>}
                </Td>
                <Td>{r.sector}</Td>
                <Td>
                  <span style={{ color: muted ? 'var(--t-2)' : 'var(--t-1)' }}>{r.travelDate ? fmtDate(r.travelDate) : '—'}</span>
                  {tag && <TravelChip tag={tag} />}
                </Td>
                <Td align="right" mono>{fmtINR(Number(r.fareAmount))}</Td>
                <Td align="right" mono>
                  <span style={{ color: d > 0 ? 'var(--rust)' : 'var(--sage)', fontWeight: d > 0 ? 700 : 400 }}>
                    {d > 0 ? fmtINR(d) : '—'}
                  </span>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.status === 'Held' && <Todo tone="amber">Issue ticket</Todo>}
                    {d > 0 && <Todo tone="rust">Collect {fmtINR(d)}</Todo>}
                    {r.status !== 'Held' && d === 0 && <StatusPill status={r.status} />}
                  </div>
                </Td>
                <Td align="right"><RowBtn onClick={() => onEdit(r)}>Open</RowBtn></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Group({ title, count, tone, children }: { title: string; count: number; tone?: 'rust'; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: tone === 'rust' ? 'var(--rust, #B5483D)' : 'var(--t-2)', margin: 0 }}>{title}</h3>
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--t-3)',
          background: 'var(--bg-2, #f6f8fb)', border: '1px solid var(--line, #e7eaf0)',
          borderRadius: 999, padding: '1px 9px',
        }}>{count}</span>
      </div>
      {children}
    </section>
  );
}
function TravelChip({ tag }: { tag: { text: string; tone: 'rust' | 'amber' | 'muted' } }) {
  const c = tag.tone === 'rust'
    ? { bg: 'rgba(181,72,61,.10)', fg: 'var(--rust, #B5483D)' }
    : tag.tone === 'amber'
    ? { bg: 'rgba(217,165,69,.18)', fg: '#B58430' }
    : { bg: 'var(--bg-2, #f6f8fb)', fg: 'var(--t-3)' };
  return (
    <span style={{
      marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
      background: c.bg, color: c.fg, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>{tag.text}</span>
  );
}
function Todo({ children, tone }: { children: React.ReactNode; tone: 'rust' | 'amber' }) {
  const c = tone === 'rust'
    ? { bg: 'rgba(181,72,61,.10)', fg: 'var(--rust, #B5483D)' }
    : { bg: 'rgba(217,165,69,.18)', fg: '#B58430' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
      background: c.bg, color: c.fg, padding: '4px 8px', borderRadius: 6, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rust' | 'amber' }) {
  const color = tone === 'rust' ? 'var(--rust, #B5483D)' : tone === 'amber' ? '#B58430' : 'var(--navy-deep)';
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12,
      padding: '14px 18px', minWidth: 160,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color }}>{value}</div>
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
