// ============================================================
// /portal/checkin — offsite self check-in (GPS-stamped).
// ============================================================
// For field / second-location staff who don't punch the office machine.
// Big Check-in / Check-out buttons capture your phone's GPS and record
// the day's attendance instantly. Self-scoped to your own record; anyone
// not set to "offsite" mode sees a friendly notice instead.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtDate } from '../../lib/fmt';

type Day = {
  date: string; status: string; actualIn: string | null; actualOut: string | null;
  isOvertime: boolean; remark: string | null;
};
type Status = {
  linked: boolean;
  isOffsite?: boolean;
  mode?: string;
  employee?: { name: string; hrCode: string; department: string | null };
  today?: { iso: string; checkedIn: boolean; checkedOut: boolean; ins: number; outs: number };
  days?: Day[];
};

export default function CheckinPage() {
  return (
    <AppShell title="My Check-in" crumb="My Check-in">
      <CheckinInner />
    </AppShell>
  );
}

function CheckinInner() {
  const [st, setSt] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'IN' | 'OUT' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/attendance/checkin');
      const d = await r.json();
      if (!d.ok) setError(d.error || 'Failed to load');
      else setSt(d);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Best-effort GPS: resolves coords, or null if the device can't / won't.
  function getLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      );
    });
  }

  async function check(kind: 'IN' | 'OUT') {
    setBusy(kind); setError(null); setMsg(null);
    try {
      const loc = await getLocation();
      if (!loc) {
        const proceed = confirm("Couldn't get your location (GPS off or permission denied). Record this check-in WITHOUT a location?");
        if (!proceed) { setBusy(null); return; }
      }
      const r = await fetch('/api/attendance/checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, lat: loc?.lat ?? null, lng: loc?.lng ?? null, accuracy: loc?.accuracy ?? null }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Could not record check-in'); setBusy(null); return; }
      setMsg(`${kind === 'IN' ? 'Checked in' : 'Checked out'} at ${d.at}${loc ? '' : ' (no location)'}.`);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  if (loading && !st) return <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading…</div>;

  if (st && !st.linked) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '4px 4px 60px' }}>
        <Banner kind="info">Your login isn't linked to an employee record yet. Ask the owner to link it in Employees, then you can check in here.</Banner>
      </div>
    );
  }

  if (st && st.linked && !st.isOffsite) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '4px 4px 60px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: '0 0 10px' }}>My Check-in</h1>
        <Banner kind="info">
          Your attendance is recorded at the office biometric machine, so you don't need to check in here.
          If you work in the field or at another location, ask the owner to switch you to <b>Offsite</b> in the Employees master.
        </Banner>
      </div>
    );
  }

  const today = st?.today;
  const checkedIn = !!today?.checkedIn;
  const checkedOut = !!today?.checkedOut;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '4px 4px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>My Check-in</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 18px' }}>
        {st?.employee?.name} · {st?.employee?.hrCode}{st?.employee?.department ? ` · ${st.employee.department}` : ''}
      </p>

      {error && <div style={{ marginBottom: 12 }}><Banner kind="error">{error}</Banner></div>}
      {msg && <div style={{ marginBottom: 12 }}><Banner kind="info">{msg}</Banner></div>}

      <div style={{ padding: 22, borderRadius: 16, border: '1px solid rgba(15,40,85,0.12)', background: 'rgba(15,40,85,0.025)', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
          Today · {today ? fmtDate(today.iso) : ''}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: checkedIn ? '#2E6C54' : 'var(--ink)', margin: '8px 0 18px' }}>
          {checkedIn
            ? (checkedOut ? 'Checked in and out for today' : "You're checked in")
            : 'Not checked in yet today'}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => check('IN')} disabled={busy !== null} style={{ ...bigBtn('#1A3F7E'), opacity: busy ? 0.6 : 1 }}>
            {busy === 'IN' ? 'Locating…' : (checkedIn ? 'Check in again' : 'Check in')}
          </button>
          <button onClick={() => check('OUT')} disabled={busy !== null || !checkedIn} style={{ ...bigBtn('#2E6C54'), opacity: (busy || !checkedIn) ? 0.45 : 1 }}>
            {busy === 'OUT' ? 'Locating…' : 'Check out'}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 14 }}>
          Your location is captured to confirm where you checked in. Allow location access when your phone asks.
        </div>
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '26px 0 10px' }}>This month</h2>
      {(!st?.days || st.days.length === 0) ? (
        <div style={{ padding: 28, color: 'var(--ink-soft)', textAlign: 'center', border: '1px dashed rgba(15,40,85,0.18)', borderRadius: 12 }}>
          No check-ins recorded this month yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(15,40,85,0.04)', textAlign: 'left' }}>
                {['Date', 'Status', 'In', 'Out', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {st.days.map(d => (
                <tr key={d.date} style={{ borderTop: '1px solid rgba(15,40,85,0.06)' }}>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(d.date)}</td>
                  <td style={td}><span style={pill(d.status)}>{statusLabel(d.status)}</span></td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{d.actualIn || '—'}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{d.actualOut || '—'}</td>
                  <td style={td}>{d.isOvertime && <span style={pill('OVERTIME')}>OT</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── small bits ──────────────────────────────────────────────
function statusLabel(s: string): string {
  return ({ PRESENT: 'Present', OFF_DAY: 'Weekly off', HOLIDAY: 'Holiday', LEAVE: 'Leave', HALF_DAY: 'Half day', ABSENT: 'Absent', LATE: 'Late', ON_DUTY: 'On duty' } as Record<string, string>)[s] || s;
}
function bigBtn(bg: string): React.CSSProperties {
  return { padding: '14px 26px', borderRadius: 12, background: bg, color: '#fff', border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', minWidth: 150 };
}
function Banner({ kind, children }: { kind: 'error' | 'info'; children: React.ReactNode }) {
  const isErr = kind === 'error';
  return <div style={{ padding: '11px 15px', borderRadius: 10, fontSize: 13, color: isErr ? 'var(--rust, #B5483D)' : 'var(--navy-deep, #1A3F7E)', background: isErr ? 'rgba(181,72,61,0.08)' : 'rgba(15,40,85,0.05)', border: `1px solid ${isErr ? 'rgba(181,72,61,0.25)' : 'rgba(15,40,85,0.15)'}` }}>{children}</div>;
}
const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const td: React.CSSProperties = { padding: '9px 12px', color: 'var(--ink)' };
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
