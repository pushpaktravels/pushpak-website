// ============================================================
// /portal/leave-admin — HR records leave ON BEHALF of staff.
// ============================================================
// For people who can't run "My Leave" themselves (support / field
// staff). HR picks the employee, the leave type and dates, and records
// it — same instant effect as self-service (no approval), drawn from
// that person's paid-leave balance and fed into the attendance engine.
// Crucially, recording a leave for an OFFSITE employee is what stops a
// genuine day off from being counted as an auto-absent.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { LEAVE_KINDS, LEAVE_LABEL, LEAVE_HINT, isSingleDayKind, type LeaveKindSS } from '../../lib/leave';
import { fmtDate } from '../../lib/fmt';

type Emp = { id: string; name: string; hrCode: string; department: string | null; attendanceMode: string };
type Leave = {
  id: string; fromDate: string; toDate: string; days: string | number;
  kind: LeaveKindSS; reason: string | null; notes: string | null; status: string;
  appliedBy: string | null; createdAt: string;
};
type Balance = { opening: string | number; used: string | number; remaining: string | number };
type Detail = { fy: string; employee: Emp; balance: Balance; leaves: Leave[] };

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LeaveAdminPage() {
  return (
    <AppShell title="Record Leave" crumb="Record Leave">
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [empId, setEmpId] = useState('');
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadEmployees() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/attendance/leave-admin');
      const d = await r.json();
      if (!d.ok) setError(d.error || 'Failed to load');
      else setEmployees(d.employees || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadEmployees(); }, []);

  async function loadDetail(id: string) {
    if (!id) { setDetail(null); return; }
    setLoadingDetail(true); setError(null);
    try {
      const r = await fetch(`/api/attendance/leave-admin?employeeId=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!d.ok) setError(d.error || 'Failed to load');
      else setDetail(d.detail || null);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingDetail(false); }
  }
  useEffect(() => { loadDetail(empId); /* eslint-disable-next-line */ }, [empId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.hrCode || '').toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q),
    );
  }, [employees, filter]);

  if (loading) return <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading…</div>;

  const selected = employees.find(e => e.id === empId) || null;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '4px 4px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>Record Leave</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 18px' }}>
        Record time off on behalf of staff who can't file it themselves. It's saved instantly — no approval —
        and (for offsite staff) keeps a genuine day off from counting as an absence.
      </p>

      {error && <div style={{ marginBottom: 12 }}><Banner kind="error">{error}</Banner></div>}
      {msg && <div style={{ marginBottom: 12 }}><Banner kind="info">{msg}</Banner></div>}

      {/* Employee picker */}
      <div style={{ padding: 18, borderRadius: 12, border: '1px solid rgba(15,40,85,0.12)', background: 'rgba(15,40,85,0.025)', marginBottom: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>Whose leave?</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Search">
            <input style={{ ...inp, width: 220 }} value={filter} placeholder="Name, HR code, department" onChange={e => setFilter(e.target.value)} />
          </Field>
          <Field label="Employee">
            <select style={{ ...inp, minWidth: 280 }} value={empId} onChange={e => setEmpId(e.target.value)}>
              <option value="">— Select an employee —</option>
              {filtered.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.hrCode}{e.department ? ` · ${e.department}` : ''}{e.attendanceMode === 'offsite' ? ' · Offsite' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {!selected ? (
        <div style={{ padding: 28, color: 'var(--ink-soft)', textAlign: 'center', border: '1px dashed rgba(15,40,85,0.18)', borderRadius: 12 }}>
          Pick an employee to record their leave.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{selected.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{selected.hrCode}{selected.department ? ` · ${selected.department}` : ''}</span>
            {selected.attendanceMode === 'offsite' && <span style={pill('sage')}>Offsite</span>}
          </div>

          {detail?.balance && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <Card label="Paid leaves remaining" value={Number(detail.balance.remaining)} tone="sage" />
              <Card label="Used this year" value={Number(detail.balance.used)} tone="gold" />
              <Card label="Annual allowance" value={Number(detail.balance.opening)} tone="navy" />
            </div>
          )}

          <DeclareForm
            employeeId={selected.id}
            onDone={(m) => { setMsg(m); loadDetail(empId); loadEmployees(); }}
            onError={setError}
          />

          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '26px 0 10px' }}>
            {detail?.fy ? `Leaves this year (${detail.fy})` : 'Leaves this year'}
          </h2>
          {loadingDetail ? (
            <div style={{ padding: 20, color: 'var(--ink-soft)' }}>Loading…</div>
          ) : (!detail || detail.leaves.length === 0) ? (
            <div style={{ padding: 28, color: 'var(--ink-soft)', textAlign: 'center', border: '1px dashed rgba(15,40,85,0.18)', borderRadius: 12 }}>
              No leaves recorded for this employee yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(15,40,85,0.04)', textAlign: 'left' }}>
                    {['Type', 'From', 'To', 'Days', 'Reason', 'Filed by', ''].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {detail.leaves.map(l => (
                    <LeaveRow key={l.id} lv={l} onChanged={() => { loadDetail(empId); loadEmployees(); }} onError={setError} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeclareForm({ employeeId, onDone, onError }: { employeeId: string; onDone: (msg: string) => void; onError: (s: string) => void }) {
  const [kind, setKind] = useState<LeaveKindSS>('FULL_DAY');
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const single = isSingleDayKind(kind);
  const isFullDay = kind === 'FULL_DAY';

  async function submit() {
    setBusy(true); onError('');
    try {
      const body: any = { employeeId, kind, fromDate, reason: reason || null };
      if (isFullDay) body.toDate = toDate;
      const r = await fetch('/api/attendance/leave-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) { onError(d.error || 'Could not record leave'); setBusy(false); return; }
      setReason('');
      onDone(`${LEAVE_LABEL[kind]} recorded for ${fromDate}${isFullDay && toDate !== fromDate ? `–${toDate}` : ''}.`);
    } catch (e: any) { onError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 18, borderRadius: 12, border: '1px solid rgba(15,40,85,0.12)', background: 'rgba(46,108,84,0.04)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>Record a leave</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Type">
          <select style={{ ...inp, width: 170 }} value={kind} onChange={e => setKind(e.target.value as LeaveKindSS)}>
            {LEAVE_KINDS.map(k => <option key={k} value={k}>{LEAVE_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label={single || !isFullDay ? 'Date' : 'From'}>
          <input type="date" style={inp} value={fromDate} onChange={e => { setFromDate(e.target.value); if (e.target.value > toDate) setToDate(e.target.value); }} />
        </Field>
        {isFullDay && (
          <Field label="To">
            <input type="date" style={inp} min={fromDate} value={toDate} onChange={e => setToDate(e.target.value)} />
          </Field>
        )}
        <Field label="Reason (optional)">
          <input style={{ ...inp, width: 220 }} value={reason} placeholder="e.g. family function" onChange={e => setReason(e.target.value)} />
        </Field>
        <button onClick={submit} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.55 : 1 }}>
          {busy ? 'Saving…' : 'Record'}
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
      const r = await fetch(`/api/attendance/leave-admin?id=${encodeURIComponent(lv.id)}`, { method: 'DELETE' });
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
      <td style={{ ...td, color: 'var(--ink-soft)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lv.reason || '—'}</td>
      <td style={{ ...td, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{lv.appliedBy || '—'}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <button onClick={cancel} disabled={busy} style={{ ...btnLink, color: '#B5483D' }}>{busy ? '…' : 'Cancel'}</button>
      </td>
    </tr>
  );
}

// ─── small bits ──────────────────────────────────────────────
function toneFor(k: LeaveKindSS): 'navy' | 'gold' | 'sage' {
  if (k === 'FULL_DAY') return 'navy';
  if (k === 'HALF_DAY') return 'gold';
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
function pill(tone: 'sage' | 'gold' | 'navy'): React.CSSProperties {
  const map = {
    sage: ['rgba(46,108,84,0.12)', '#2E6C54'],
    gold: ['rgba(201,164,114,0.18)', '#9A7634'],
    navy: ['rgba(15,40,85,0.10)', 'var(--navy-deep, #1A3F7E)'],
  }[tone];
  return { padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: map[0], color: map[1], display: 'inline-block' };
}
