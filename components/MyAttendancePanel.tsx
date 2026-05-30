// ============================================================
// MyAttendancePanel — self-service attendance for the logged-in user.
// ============================================================
// Drop-in, self-contained. Fetches /api/attendance/mine (hard-scoped
// to the caller — never another employee). Two modes:
//   mode="summary"  → compact tile for the Dashboard.
//   mode="detail"   → month picker + day-by-day table for My Profile.
// Renders nothing-but-a-hint when the login isn't yet linked to an
// employee (the owner links it in the Employees master).
// ============================================================
import { useEffect, useState } from 'react';

type Summary = {
  present: number; late: number; halfDay: number; absent: number;
  leave: number; offDay: number; holiday: number; onDuty: number;
  specialPaid: number; informed: number; deductionDays: number;
};
type Day = {
  date: string; status: string;
  actualIn: string | null; actualOut: string | null;
  scheduledIn: string | null; scheduledOut: string | null;
  lateByMin: number | null; earlyGoingMin: number | null;
  isInformed: boolean; deductionDays: string | number; remark: string | null;
};
type Feed = {
  ok: boolean; linked: boolean; month: string;
  employee?: { name: string; hrCode: string; department: string | null; designation: string | null; shiftIn: string | null; shiftOut: string | null; weeklyOffDay: number };
  summary?: Summary; days?: Day[];
};

function thisMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_TONE: Record<string, 'sage' | 'rust' | 'gold' | 'navy' | 'muted'> = {
  PRESENT: 'sage', LATE: 'gold', HALF_DAY: 'gold', ABSENT: 'rust',
  LEAVE: 'navy', OFF_DAY: 'muted', HOLIDAY: 'muted', ON_DUTY: 'navy', SPECIAL_PAID: 'navy',
};
const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent',
  LEAVE: 'Leave', OFF_DAY: 'Off day', HOLIDAY: 'Holiday', ON_DUTY: 'On duty', SPECIAL_PAID: 'Special paid',
};

export default function MyAttendancePanel({ mode = 'detail' }: { mode?: 'summary' | 'detail' }) {
  const [month, setMonth] = useState<string>(thisMonth());
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    fetch(`/api/attendance/mine?month=${month}`)
      .then(r => r.json())
      .then((d: Feed) => { if (!live) return; if (!d.ok) setError('Could not load attendance'); else setFeed(d); })
      .catch(e => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [month]);

  if (loading && !feed) return <Card><div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Loading attendance…</div></Card>;
  if (error) return <Card><div style={{ color: 'var(--rust, #B5483D)', fontSize: 13 }}>{error}</div></Card>;
  if (feed && !feed.linked) {
    return (
      <Card>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          Your login isn’t linked to an employee record yet. Once HR links it, your attendance will appear here.
        </div>
      </Card>
    );
  }
  if (!feed || !feed.summary) return null;
  const s = feed.summary;

  if (mode === 'summary') {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>My attendance</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{monthLabel(feed.month)}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <Stat label="Present" value={s.present} tone="sage" />
          <Stat label="Absent" value={s.absent} tone="rust" />
          <Stat label="Late" value={s.late} tone="gold" />
          <Stat label="Leave" value={s.leave} tone="navy" />
        </div>
        {s.deductionDays > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-soft)' }}>
            Deduction this month: <b style={{ color: 'var(--rust, #B5483D)' }}>{s.deductionDays} day{s.deductionDays === 1 ? '' : 's'}</b>
          </div>
        )}
      </Card>
    );
  }

  // detail
  const days = feed.days || [];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setMonth(m => shiftMonth(m, -1))} style={navBtn}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', minWidth: 150, textAlign: 'center' }}>{monthLabel(feed.month)}</div>
        <button onClick={() => setMonth(m => shiftMonth(m, 1))} style={navBtn} disabled={feed.month >= thisMonth()}>›</button>
        {loading && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Loading…</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 10, marginBottom: 20 }}>
        <Stat label="Present" value={s.present} tone="sage" />
        <Stat label="Late" value={s.late} tone="gold" />
        <Stat label="Half day" value={s.halfDay} tone="gold" />
        <Stat label="Absent" value={s.absent} tone="rust" />
        <Stat label="Leave" value={s.leave} tone="navy" />
        <Stat label="Off / Holiday" value={s.offDay + s.holiday} tone="muted" />
        <Stat label="Deduction" value={s.deductionDays} tone="rust" />
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(15,40,85,0.04)', textAlign: 'left' }}>
              {['Date', 'Status', 'In', 'Out', 'Late', 'Early Out', 'Deduction', 'Remark'].map(h => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {days.length === 0 ? (
              <tr><td style={{ ...td, color: 'var(--ink-soft)' }} colSpan={8}>No records for this month yet.</td></tr>
            ) : days.map(d => {
              const dd = Number(d.deductionDays) || 0;
              return (
                <tr key={d.date} style={{ borderTop: '1px solid rgba(15,40,85,0.06)' }}>
                  <td style={td}>{fmtDate(d.date)}</td>
                  <td style={td}>
                    <span style={pill(STATUS_TONE[d.status] || 'muted')}>{STATUS_LABEL[d.status] || d.status}</span>
                    {d.isInformed && <span style={pill('sage')}>informed</span>}
                  </td>
                  <td style={tdNum}>{d.actualIn || '—'}</td>
                  <td style={tdNum}>{d.actualOut || '—'}</td>
                  <td style={tdNum}>{d.lateByMin ? `${d.lateByMin}m` : '—'}</td>
                  <td style={tdNum}>{d.earlyGoingMin ? `${d.earlyGoingMin}m` : '—'}</td>
                  <td style={tdNum}>{dd > 0 ? dd : '—'}</td>
                  <td style={{ ...td, color: 'var(--ink-soft)' }}>{d.remark || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 18, borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)', background: '#fff' }}>{children}</div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'sage' | 'rust' | 'gold' | 'navy' | 'muted' }) {
  const color = { sage: '#2E6C54', rust: '#B5483D', gold: '#9A7634', navy: 'var(--navy-deep, #1A3F7E)', muted: 'var(--ink-soft)' }[tone];
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(15,40,85,0.03)', border: '1px solid rgba(15,40,85,0.07)' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 5 }}>{label}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const td: React.CSSProperties = { padding: '9px 12px', color: 'var(--ink)' };
const tdNum: React.CSSProperties = { ...td, fontVariantNumeric: 'tabular-nums' };
const navBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, background: '#fff', border: '1px solid rgba(15,40,85,0.22)', fontSize: 18, fontWeight: 700, cursor: 'pointer', color: 'var(--ink)', lineHeight: 1 };
function pill(tone: 'sage' | 'rust' | 'gold' | 'navy' | 'muted'): React.CSSProperties {
  const map = {
    sage: ['rgba(46,108,84,0.12)', '#2E6C54'],
    rust: ['rgba(181,72,61,0.12)', '#B5483D'],
    gold: ['rgba(201,164,114,0.18)', '#9A7634'],
    navy: ['rgba(26,63,126,0.12)', 'var(--navy-deep, #1A3F7E)'],
    muted: ['rgba(15,40,85,0.08)', 'var(--ink-soft)'],
  }[tone];
  return { marginRight: 6, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: map[0], color: map[1], whiteSpace: 'nowrap' };
}
