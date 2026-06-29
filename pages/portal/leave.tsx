// ============================================================
// /portal/leave — employee self-service leave (no approval).
// ============================================================
// Declare your own time off (full day, half day, late arrival, early
// out). It records instantly — there's no approver — draws full/half
// days from your paid-leave balance, and feeds straight into the
// attendance engine so you never show as an unexplained absentee.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { LEAVE_KINDS, LEAVE_LABEL, LEAVE_HINT, type LeaveKindSS } from '../../lib/leave';
import { type PeriodInsight } from '../../lib/period-leave';
import { fmtDate } from '../../lib/fmt';

// Full-day, half-day AND period leave can cover a date range (show a "To" field);
// the partial informed kinds are a single day.
const hasRange = (k: LeaveKindSS) => k === 'FULL_DAY' || k === 'PERIOD_LEAVE';

type Leave = {
  id: string; fromDate: string; toDate: string; days: string | number;
  kind: LeaveKindSS; reason: string | null; notes: string | null; status: string; createdAt: string;
};
type Balance = { opening: string | number; used: string | number; remaining: string | number };

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LeavePage() {
  return (
    <AppShell title="My Leave" crumb="My Leave">
      <LeaveInner />
    </AppShell>
  );
}

function LeaveInner() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [periodEligible, setPeriodEligible] = useState(false);
  const [period, setPeriod] = useState<PeriodInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/leave');
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Failed to load'); setLinked(false); }
      else {
        setLinked(d.linked); setLeaves(d.leaves || []); setBalance(d.balance || null);
        setPeriodEligible(!!d.periodEligible); setPeriod(d.period || null);
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading && linked === null) return <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading…</div>;

  if (linked === false) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '4px 4px 60px' }}>
        <Banner kind="info">Your login isn't linked to an employee record yet. Ask the owner to link it in Employees, then you can declare leave here.</Banner>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '4px 4px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>My Leave</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 18px' }}>
        Declare your time off — it's recorded instantly, no approval needed.
      </p>

      {balance && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <Card label="Paid leaves remaining" value={Number(balance.remaining)} tone="sage" />
          <Card label="Used this year" value={Number(balance.used)} tone="gold" />
          <Card label="Annual allowance" value={Number(balance.opening)} tone="navy" />
        </div>
      )}

      {error && <div style={{ marginBottom: 12 }}><Banner kind="error">{error}</Banner></div>}
      {msg && <div style={{ marginBottom: 12 }}><Banner kind="info">{msg}</Banner></div>}

      {periodEligible && period?.nextExpected && (
        <div style={{ marginBottom: 14, padding: '11px 15px', borderRadius: 10, fontSize: 12.5, color: '#8A3A5C', background: 'rgba(176,80,120,0.08)', border: '1px solid rgba(176,80,120,0.22)' }}>
          Your next period leave is expected around <b>{fmtDate(period.nextExpected)}</b>
          {period.windowFrom && period.windowTo ? ` (${fmtDate(period.windowFrom)}–${fmtDate(period.windowTo)})` : ''}.
        </div>
      )}

      <DeclareForm periodEligible={periodEligible} onDone={(m) => { setMsg(m); load(); }} onError={setError} />

      <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '26px 0 10px' }}>This year's leaves</h2>
      {leaves.length === 0 ? (
        <div style={{ padding: 28, color: 'var(--ink-soft)', textAlign: 'center', border: '1px dashed rgba(15,40,85,0.18)', borderRadius: 12 }}>
          No leaves declared yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(15,40,85,0.04)', textAlign: 'left' }}>
                {['Type', 'From', 'To', 'Days', 'Reason', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {leaves.map(l => <LeaveRow key={l.id} lv={l} onChanged={load} onError={setError} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeclareForm({ periodEligible, onDone, onError }: { periodEligible: boolean; onDone: (msg: string) => void; onError: (s: string) => void }) {
  const [kind, setKind] = useState<LeaveKindSS>('FULL_DAY');
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const range = hasRange(kind);
  // Period leave is shown only to eligible (female) staff.
  const kinds = LEAVE_KINDS.filter(k => k !== 'PERIOD_LEAVE' || periodEligible);

  async function submit() {
    setBusy(true); onError('');
    try {
      const body: any = { kind, fromDate, reason: reason || null };
      if (range) body.toDate = toDate;
      const r = await fetch('/api/leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) { onError(d.error || 'Could not record leave'); setBusy(false); return; }
      setReason('');
      onDone(`${LEAVE_LABEL[kind]} recorded for ${fromDate}${range && toDate !== fromDate ? `–${toDate}` : ''}.`);
    } catch (e: any) { onError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 18, borderRadius: 12, border: '1px solid rgba(15,40,85,0.12)', background: 'rgba(15,40,85,0.025)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>Declare a leave</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Type">
          <select style={{ ...inp, width: 170 }} value={kind} onChange={e => setKind(e.target.value as LeaveKindSS)}>
            {kinds.map(k => <option key={k} value={k}>{LEAVE_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label={range ? 'From' : 'Date'}>
          <input type="date" style={inp} value={fromDate} onChange={e => { setFromDate(e.target.value); if (e.target.value > toDate) setToDate(e.target.value); }} />
        </Field>
        {range && (
          <Field label="To">
            <input type="date" style={inp} min={fromDate} value={toDate} onChange={e => setToDate(e.target.value)} />
          </Field>
        )}
        <Field label="Reason (optional)">
          <input style={{ ...inp, width: 220 }} value={reason} placeholder="e.g. family function" onChange={e => setReason(e.target.value)} />
        </Field>
        <button onClick={submit} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.55 : 1 }}>
          {busy ? 'Saving…' : 'Declare'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>{LEAVE_HINT[kind]}</div>
    </div>
  );
}

function LeaveRow({ lv, onChanged, onError }: { lv: Leave; onChanged: () => void; onError: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function cancel() {
    if (!confirm(`Cancel this ${LEAVE_LABEL[lv.kind].toLowerCase()}?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/leave/${lv.id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!d.ok) { onError(d.error || 'Cancel failed'); setBusy(false); return; }
      onChanged();
    } catch (e: any) { onError(e.message); setBusy(false); }
  }
  return (
    <tr style={{ borderTop: '1px solid rgba(15,40,85,0.06)' }}>
      <td style={td}><span style={pill(toneFor(lv.kind))}>{LEAVE_LABEL[lv.kind]}</span></td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(lv.fromDate)}</td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{lv.toDate !== lv.fromDate ? fmtDate(lv.toDate) : '—'}</td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{Number(lv.days) > 0 ? Number(lv.days) : '—'}</td>
      <td style={{ ...td, color: 'var(--ink-soft)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lv.reason || '—'}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <button onClick={cancel} disabled={busy} style={{ ...btnLink, color: '#B5483D' }}>{busy ? '…' : 'Cancel'}</button>
      </td>
    </tr>
  );
}

// ─── small bits ──────────────────────────────────────────────
function toneFor(k: LeaveKindSS): 'navy' | 'gold' | 'sage' | 'rose' {
  if (k === 'FULL_DAY') return 'navy';
  if (k === 'HALF_DAY') return 'gold';
  if (k === 'PERIOD_LEAVE') return 'rose';
  return 'sage';
}
function Card({ label, value, tone }: { label: string; value: number; tone: 'sage' | 'gold' | 'navy' }) {
  const c = { sage: '#2E6C54', gold: '#9A7634', navy: '#1A3F7E' }[tone];
  return (
    <div style={{ flex: '1 1 160px', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)', background: '#fff' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</span>
      {children}
    </div>
  );
}
function Banner({ kind, children }: { kind: 'error' | 'info'; children: React.ReactNode }) {
  const isErr = kind === 'error';
  return <div style={{ padding: '11px 15px', borderRadius: 10, fontSize: 13, color: isErr ? 'var(--rust, #B5483D)' : 'var(--navy-deep, #1A3F7E)', background: isErr ? 'rgba(181,72,61,0.08)' : 'rgba(15,40,85,0.05)', border: `1px solid ${isErr ? 'rgba(181,72,61,0.25)' : 'rgba(15,40,85,0.15)'}` }}>{children}</div>;
}
const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const td: React.CSSProperties = { padding: '9px 12px', color: 'var(--ink)' };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,40,85,0.2)', fontSize: 13, boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnLink: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 };
function pill(tone: 'sage' | 'gold' | 'navy' | 'rose'): React.CSSProperties {
  const map = {
    sage: ['rgba(46,108,84,0.12)', '#2E6C54'],
    gold: ['rgba(201,164,114,0.18)', '#9A7634'],
    navy: ['rgba(15,40,85,0.10)', 'var(--navy-deep, #1A3F7E)'],
    rose: ['rgba(176,80,120,0.14)', '#A2456B'],
  }[tone];
  return { padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: map[0], color: map[1], display: 'inline-block' };
}
