// ============================================================
// /portal/billing — Auto-billing console (Phase 3, dry-run spine).
// ============================================================
// This is where "the reservation executive puts details in the portal" turns
// into "a bill is generated in FinBook". A Ticketed booking shows in "Ready
// to bill"; you pick the FinBook ledger to bill and hit Generate — the portal
// builds the /salesdetails payload and sends it through the FinBook
// chokepoint. In DRY-RUN (default) nothing is posted for real: the bill is
// badged "Simulated" and you can preview the exact payload that WOULD go to
// FinBook. Flip FINBOOK_MODE=live (after Calico unblocks our IP) and the same
// button posts for real.
//
// Open question this surfaces: the Reservation module isn't linked to a
// FinBook client yet, so the operator supplies the ledger id at bill time.
// Mapping booking → client automatically is the next step.
// ============================================================
import { Fragment, useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR, fmtDate } from '../../lib/fmt';

type Reservation = {
  id: string; pnr: string | null; passengerName: string; paxCount: number;
  sector: string; airline: string | null; travelDate: string | null;
  fareAmount: number | string; vendor: string | null; status: string; agentName: string | null;
};
type Bill = {
  id: string; sourceId: string; refKey: string; clientId: string | null; clientLabel: string | null;
  serviceCode: string | null; amount: number | string; docPrefix: string | null; docNo: string | null;
  status: string; mode: string; simulated: boolean; payload: any; response: any; error: string | null;
  generatedByName: string | null; createdAt: string; postedAt: string | null;
};
type Summary = { simulated: number; posted: number; failed: number; billed_amount: number | string };

const STATUS_COLOR: Record<string, string> = { simulated: '#1A6FA8', posted: '#2E7D4F', failed: '#B5483D', void: '#8a8f99' };
const STATUS_LABEL: Record<string, string> = { simulated: 'Simulated', posted: 'Posted', failed: 'Failed', void: 'Void' };
const PAY_TYPES = ['', 'CASH', 'CREDIT', 'CREDIT CARD'];

export default function BillingPage() {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [billable, setBillable] = useState<Reservation[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [mode, setMode] = useState<string>('dryrun');
  const [error, setError] = useState<string | null>(null);
  const [genFor, setGenFor] = useState<string | null>(null);   // reservation id being billed
  const [expand, setExpand] = useState<string | null>(null);   // bill id whose payload is open
  const confirm = useConfirm();

  const live = mode === 'live';

  function load() {
    fetch('/api/billing')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setBills(r.data.bills || []);
        setBillable(r.data.billable || []);
        setSummary(r.data.summary || null);
        setMode(r.mode || 'dryrun');
      })
      .catch(e => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  async function generate(rsv: Reservation, ctx: { clientId: string; clientWebId: string; payType: string }) {
    if (!ctx.clientId.trim()) { setError('Enter the FinBook ledger id to bill (e.g. CCA000001).'); return; }
    if (live) {
      const ok = await confirm({ title: 'Post this bill to FinBook for real?', body: `FINBOOK_MODE is LIVE — this will create a real invoice for ${fmtINR(Number(rsv.fareAmount))}.`, confirmLabel: 'Post bill', destructive: true });
      if (!ok) return;
    }
    try {
      const res = await fetch('/api/billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId: rsv.id, clientId: ctx.clientId.trim(), clientWebId: ctx.clientWebId.trim() || null, payType: ctx.payType || null }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Generate failed');
      if (res.data?.finbookOk === false) setError(`Recorded, but FinBook returned: ${res.data.finbookError}`);
      setGenFor(null);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function voidBill(bl: Bill) {
    const ok = await confirm({ title: 'Void this bill?', body: 'Marks it void and lets the booking be billed again. Keeps the audit trail.', confirmLabel: 'Void', destructive: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/billing/${encodeURIComponent(bl.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'void' }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Void failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <AppShell title="Billing" crumb="Billing">
      <div style={{ marginBottom: 16, maxWidth: 760 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Auto-Billing Console</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
          Turn a ticketed booking into a FinBook sales bill. Pick the ledger to bill and hit Generate — the portal builds the invoice payload and sends it through the FinBook gateway.
        </p>
      </div>

      {/* Mode banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 16,
        background: live ? 'rgba(181,72,61,.08)' : 'rgba(26,111,168,.08)', border: `1px solid ${live ? 'rgba(181,72,61,.3)' : 'rgba(26,111,168,.3)'}` }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: live ? '#B5483D' : '#1A6FA8' }}>
          {live ? '● LIVE' : '○ DRY-RUN'}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>
          {live
            ? 'Bills are posted to FinBook for real. Generate with care.'
            : 'Simulated — no bill is posted to FinBook. You can preview the exact payload that would be sent.'}
        </span>
      </div>

      {error && <div style={errBox}>{error}</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, margin: '4px 0 20px' }}>
        <Stat label="Ready to bill" value={String(billable.length)} color={billable.length > 0 ? '#C98A14' : 'var(--t-3)'} />
        <Stat label={live ? 'Posted' : 'Simulated'} value={summary ? String(live ? summary.posted : summary.simulated) : '—'} color={live ? STATUS_COLOR.posted : STATUS_COLOR.simulated} />
        <Stat label="Billed value" value={summary ? fmtINR(Number(summary.billed_amount)) : '—'} color="var(--t-1)" />
        <Stat label="Failed" value={summary ? String(summary.failed) : '—'} color={summary && summary.failed > 0 ? STATUS_COLOR.failed : 'var(--t-3)'} />
      </div>

      {/* Ready to bill */}
      <h3 style={sectionLabel}>Ready to bill</h3>
      {billable.length === 0 ? (
        <div style={{ ...emptyBox, marginBottom: 24 }}>
          <p style={{ color: 'var(--t-2)', margin: 0 }}>No ticketed bookings are waiting to be billed.</p>
        </div>
      ) : (
        <div style={{ ...cardBox, marginBottom: 26 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Passenger / PNR</Th><Th>Sector</Th><Th align="right">Fare</Th><Th>Agent</Th><Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {billable.map(r => (
                <BillableRow key={r.id} r={r} open={genFor === r.id} live={live}
                  onToggle={() => setGenFor(genFor === r.id ? null : r.id)} onGenerate={generate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Generated bills */}
      <h3 style={sectionLabel}>Generated bills</h3>
      {!bills && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {bills && bills.length === 0 && (
        <div style={emptyBox}><p style={{ color: 'var(--t-2)', margin: 0 }}>No bills generated yet.</p></div>
      )}
      {bills && bills.length > 0 && (
        <div style={cardBox}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Doc no</Th><Th>Booking</Th><Th>Ledger</Th><Th align="right">Amount</Th><Th>Status</Th><Th>By</Th><Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {bills.map(bl => (
                <Fragment key={bl.id}>
                  <tr style={{ borderBottom: expand === bl.id ? 'none' : '1px solid var(--line, #e7eaf0)', opacity: bl.status === 'void' ? 0.55 : 1 }}>
                    <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{bl.docNo || '—'}</span>{bl.simulated && <span style={simTag}>SIM</span>}</Td>
                    <Td><span style={{ fontSize: 12.5, color: 'var(--navy-deep)', fontWeight: 600 }}>{bl.clientLabel || bl.sourceId}</span></Td>
                    <Td><span style={{ fontSize: 12, color: 'var(--t-2)', fontFamily: 'ui-monospace, monospace' }}>{bl.clientId || '—'}</span></Td>
                    <Td align="right"><strong>{fmtINR(Number(bl.amount))}</strong></Td>
                    <Td>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: STATUS_COLOR[bl.status] || 'var(--t-2)' }}>{STATUS_LABEL[bl.status] || bl.status}</span>
                      {bl.status === 'failed' && bl.error && <div style={{ fontSize: 10, color: STATUS_COLOR.failed }}>{bl.error}</div>}
                    </Td>
                    <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{bl.generatedByName || '—'}</span><div style={{ fontSize: 10, color: 'var(--t-3)' }}>{fmtDate(bl.createdAt)}</div></Td>
                    <Td align="right">
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <RowBtn onClick={() => setExpand(expand === bl.id ? null : bl.id)}>{expand === bl.id ? 'Hide' : 'Payload'}</RowBtn>
                        {bl.status !== 'void' && <RowBtn onClick={() => voidBill(bl)}>Void</RowBtn>}
                      </div>
                    </Td>
                  </tr>
                  {expand === bl.id && (
                    <tr style={{ borderBottom: '1px solid var(--line, #e7eaf0)', background: '#0f172a' }}>
                      <td colSpan={7} style={{ padding: 14 }}>
                        <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8 }}>/salesdetails payload {bl.simulated ? '(simulated — not sent)' : '(sent to FinBook)'}</div>
                        <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace' }}>
                          {JSON.stringify(bl.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ─── A booking that can be billed (with the inline generate form) ──
function BillableRow({ r, open, live, onToggle, onGenerate }: {
  r: Reservation; open: boolean; live: boolean; onToggle: () => void;
  onGenerate: (r: Reservation, ctx: { clientId: string; clientWebId: string; payType: string }) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientWebId, setClientWebId] = useState('');
  const [payType, setPayType] = useState('');

  return (
    <>
      <tr style={{ borderBottom: open ? 'none' : '1px solid var(--line, #e7eaf0)' }}>
        <Td>
          <div style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{r.passengerName}</div>
          {r.pnr && <div style={{ fontSize: 10.5, color: 'var(--t-3)' }}>PNR {r.pnr}{r.airline ? ` · ${r.airline}` : ''}</div>}
        </Td>
        <Td><span style={{ fontSize: 12.5 }}>{r.sector}</span>{r.travelDate && <div style={{ fontSize: 10.5, color: 'var(--t-3)' }}>{fmtDate(r.travelDate)}</div>}</Td>
        <Td align="right"><strong>{fmtINR(Number(r.fareAmount))}</strong></Td>
        <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{r.agentName || '—'}</span></Td>
        <Td align="right"><RowBtn onClick={onToggle}>{open ? 'Close' : 'Generate bill'}</RowBtn></Td>
      </tr>
      {open && (
        <tr style={{ borderBottom: '1px solid var(--line, #e7eaf0)', background: 'var(--bg-2, #f9fafc)' }}>
          <td colSpan={5} style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <MiniField label="FinBook ledger id *"><input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="CCA000001" style={{ ...inputStyle, maxWidth: 170, fontFamily: 'ui-monospace, monospace' }} /></MiniField>
              <MiniField label="Web id (opt)"><input value={clientWebId} onChange={e => setClientWebId(e.target.value)} placeholder="CCL000001" style={{ ...inputStyle, maxWidth: 150, fontFamily: 'ui-monospace, monospace' }} /></MiniField>
              <MiniField label="Pay type"><select value={payType} onChange={e => setPayType(e.target.value)} style={{ ...inputStyle, maxWidth: 150 }}>{PAY_TYPES.map(p => <option key={p} value={p}>{p || '—'}</option>)}</select></MiniField>
              <button onClick={() => onGenerate(r, { clientId, clientWebId, payType })}
                style={{ ...addBtn, padding: '9px 16px', background: live ? '#B5483D' : 'var(--navy-deep)' }}>
                {live ? 'POST BILL (LIVE)' : 'GENERATE (SIMULATED)'}
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--t-3)', alignSelf: 'center' }}>
                Booking isn’t linked to a FinBook client yet — pick the ledger to bill.
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={statCard}>
      <div style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 4 }}>{label}</span>
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

const sectionLabel: React.CSSProperties = { fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, margin: '0 0 10px' };
const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff' };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(15,40,85,.18)' };
const statCard: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: '12px 14px' };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '28px 24px', textAlign: 'center' };
const simTag: React.CSSProperties = { marginLeft: 6, fontSize: 9, fontWeight: 800, letterSpacing: '.08em', color: '#1A6FA8', background: 'rgba(26,111,168,.12)', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' };
