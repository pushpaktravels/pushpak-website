// ============================================================
// /portal/offsite — owner/HR review of offsite (self check-in) staff.
// ============================================================
// The verification surface for field / second-location attendance:
// per employee, a month tally (present / absent / leave / off / holiday
// / overtime) and a day-by-day breakdown of their GPS check-ins —
// in/out time, location (map link), and accuracy — with auto-filled
// ABSENT days for the working days they didn't check in.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtDate } from '../../lib/fmt';

type GridDay = {
  date: string; status: string; isOvertime: boolean; source: string;
  inAt: string | null; outAt: string | null;
  lat: number | null; lng: number | null; accuracy: number | null; note: string | null;
  future: boolean;
};
type Counts = { present: number; absent: number; leave: number; halfDay: number; offDay: number; holiday: number; overtime: number };
type Row = { employeeId: string; name: string; hrCode: string; department: string | null; counts: Counts; days: GridDay[] };

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function OffsitePage() {
  return (
    <AppShell title="Offsite Attendance" crumb="Offsite Attendance">
      <OffsiteInner />
    </AppShell>
  );
}

function OffsiteInner() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [totalCheckins, setTotalCheckins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/attendance/offsite?month=${month}`);
      const d = await r.json();
      if (!d.ok) setError(d.error || 'Failed to load');
      else { setRows(d.rows || []); setTotalCheckins(d.totalCheckins || 0); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month]);

  const totalAbsent = rows.reduce((s, r) => s + r.counts.absent, 0);
  const totalPresent = rows.reduce((s, r) => s + r.counts.present, 0);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '4px 4px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>Offsite Attendance</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 18px' }}>
        Field &amp; second-location staff who self check-in. Working days with no check-in are counted absent.
      </p>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <Field label="Month">
          <input type="month" style={inp} value={month} onChange={e => setMonth(e.target.value)} />
        </Field>
        <Card label="Offsite staff" value={rows.length} tone="navy" />
        <Card label="Check-ins" value={totalCheckins} tone="sage" />
        <Card label="Present days" value={totalPresent} tone="sage" />
        <Card label="Absent days" value={totalAbsent} tone="rust" />
      </div>

      {error && <div style={{ marginBottom: 12 }}><Banner kind="error">{error}</Banner></div>}

      {loading ? (
        <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, color: 'var(--ink-soft)', textAlign: 'center', border: '1px dashed rgba(15,40,85,0.18)', borderRadius: 12 }}>
          No employees are on offsite mode. Switch a field employee to <b>Offsite</b> in the Employees master to track them here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(r => <EmployeeCard key={r.employeeId} row={r} />)}
        </div>
      )}
    </div>
  );
}

function EmployeeCard({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const c = row.counts;
  // Only the days that matter: real check-ins + absences (hide blank future days).
  const shownDays = row.days.filter(d => d.status && !d.future);

  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)', background: '#fff', overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', flexWrap: 'wrap' }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 160 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{row.hrCode}{row.department ? ` · ${row.department}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Stat label="Present" value={c.present} tone="sage" />
          <Stat label="Absent" value={c.absent} tone="rust" />
          <Stat label="Leave" value={c.leave + c.halfDay} tone="navy" />
          <Stat label="Off/Hol" value={c.offDay + c.holiday} tone="navy" />
          {c.overtime > 0 && <Stat label="OT" value={c.overtime} tone="gold" />}
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-soft)', marginLeft: 'auto' }}>{open ? '▲ Hide' : '▼ Details'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid rgba(15,40,85,0.08)', overflowX: 'auto' }}>
          {shownDays.length === 0 ? (
            <div style={{ padding: 18, color: 'var(--ink-soft)', fontSize: 13 }}>No recorded days yet this month.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(15,40,85,0.03)', textAlign: 'left' }}>
                  {['Date', 'Status', 'In', 'Out', 'Location', 'Accuracy'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shownDays.map(d => (
                  <tr key={d.date} style={{ borderTop: '1px solid rgba(15,40,85,0.05)' }}>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</td>
                    <td style={td}>
                      <span style={pill(d.status)}>{statusLabel(d.status)}</span>
                      {d.isOvertime && <span style={{ ...pill('OVERTIME'), marginLeft: 6 }}>OT</span>}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{d.inAt || '—'}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{d.outAt || '—'}</td>
                    <td style={td}>
                      {d.lat != null && d.lng != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${d.lat},${d.lng}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: '#1A3F7E', fontWeight: 600, textDecoration: 'none' }}
                        >
                          {d.lat.toFixed(5)}, {d.lng.toFixed(5)} ↗
                        </a>
                      ) : (
                        <span style={{ color: 'var(--ink-soft)' }}>{d.status === 'PRESENT' ? 'no location' : '—'}</span>
                      )}
                    </td>
                    <td style={{ ...td, color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums' }}>
                      {d.accuracy != null ? `±${Math.round(d.accuracy)} m` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── small bits ──────────────────────────────────────────────
function statusLabel(s: string): string {
  return ({ PRESENT: 'Present', OFF_DAY: 'Weekly off', HOLIDAY: 'Holiday', LEAVE: 'Leave', HALF_DAY: 'Half day', ABSENT: 'Absent', LATE: 'Late', ON_DUTY: 'On duty' } as Record<string, string>)[s] || s;
}
function Stat({ label, value, tone }: { label: string; value: number; tone: 'sage' | 'gold' | 'navy' | 'rust' }) {
  const c = { sage: '#2E6C54', gold: '#9A7634', navy: '#1A3F7E', rust: '#B5483D' }[tone];
  return (
    <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(15,40,85,0.04)', textAlign: 'center', minWidth: 54 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</div>
    </div>
  );
}
function Card({ label, value, tone }: { label: string; value: number; tone: 'sage' | 'gold' | 'navy' | 'rust' }) {
  const c = { sage: '#2E6C54', gold: '#9A7634', navy: '#1A3F7E', rust: '#B5483D' }[tone];
  return (
    <div style={{ flex: '0 1 130px', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)', background: '#fff' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 2 }}>{label}</div>
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
const th: React.CSSProperties = { padding: '9px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const td: React.CSSProperties = { padding: '8px 12px', color: 'var(--ink)' };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,40,85,0.2)', fontSize: 13, boxSizing: 'border-box' };
function pill(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    PRESENT: ['rgba(46,108,84,0.12)', '#2E6C54'],
    LATE: ['rgba(201,164,114,0.18)', '#9A7634'],
    OFF_DAY: ['rgba(15,40,85,0.08)', '#1A3F7E'],
    HOLIDAY: ['rgba(15,40,85,0.08)', '#1A3F7E'],
    LEAVE: ['rgba(15,40,85,0.10)', '#1A3F7E'],
    HALF_DAY: ['rgba(201,164,114,0.18)', '#9A7634'],
    ABSENT: ['rgba(181,72,61,0.10)', '#B5483D'],
    ON_DUTY: ['rgba(46,108,84,0.12)', '#2E6C54'],
    OVERTIME: ['rgba(201,164,114,0.22)', '#9A7634'],
  };
  const [bg, c] = map[status] || ['rgba(15,40,85,0.08)', 'var(--ink)'];
  return { padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: bg, color: c, display: 'inline-block' };
}
