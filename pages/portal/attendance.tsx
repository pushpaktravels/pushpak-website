// ============================================================
// Attendance — daily summary + biometric upload.
// ============================================================
// Pick a date to see everyone's status for that day (colour-coded:
// late = amber, absent = red, informed-absence = green). Override any
// row by hand (mark a leave, holiday, on-duty, or flag it as informed).
// Upload today's + yesterday's biometric export to ingest punches.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Row = {
  id: string;
  employeeId: string;
  machineCode: string | null;
  date: string;
  scheduledIn: string | null;
  scheduledOut: string | null;
  actualIn: string | null;
  actualOut: string | null;
  lateByMin: number | null;
  earlyGoingMin: number | null;
  workDurMin: number | null;
  status: string;
  isInformed: boolean;
  deductionDays: string | number;
  remark: string | null;
  source: string | null;
  overridden: boolean;
  overrideBy: string | null;
  name: string;
  hrCode: string;
  department: string | null;
  designation: string | null;
};

type UploadSummary = {
  files: { fileName: string; reportDate: string | null; rows: number; warnings: string[] }[];
  dates: string[];
  daysUpserted: number;
  newEmployees: number;
  matched: number;
  unmatched: number;
};

const STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'OFF_DAY', 'HOLIDAY', 'ON_DUTY', 'SPECIAL_PAID'] as const;

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half Day', ABSENT: 'Absent',
  LEAVE: 'Leave', OFF_DAY: 'Weekly Off', HOLIDAY: 'Holiday', ON_DUTY: 'On Duty', SPECIAL_PAID: 'Special Paid',
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AttendancePage() {
  return (
    <AppShell title="Attendance" crumb="Attendance">
      <AttendanceInner />
    </AppShell>
  );
}

function AttendanceInner() {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(d: string) {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/attendance/daily?date=${d}`);
      const data = await r.json();
      if (!data.ok) setError(data.error || 'Failed to load');
      else setRows(data.rows);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(date); }, [date]);

  const counts = rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {} as Record<string, number>);
  const summaryBits = [
    `${counts.PRESENT || 0} present`,
    `${counts.LATE || 0} late`,
    `${counts.HALF_DAY || 0} half`,
    `${counts.ABSENT || 0} absent`,
    `${(counts.LEAVE || 0) + (counts.SPECIAL_PAID || 0)} leave`,
  ];

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Attendance</h1>
        <input type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} style={inp} />
        {!loading && rows.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{summaryBits.join(' · ')}</div>
        )}
      </div>

      <UploadWidget onDone={(touched) => { if (touched.includes(date)) load(date); }} />

      {error && <Banner kind="error">{error}</Banner>}

      {loading ? (
        <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, color: 'var(--ink-soft)', textAlign: 'center', border: '1px dashed rgba(15,40,85,0.18)', borderRadius: 12 }}>
          No attendance recorded for {date}. Upload that day's biometric export above.
        </div>
      ) : (
        <>
          <SameDayHeading date={date} rows={rows} />
          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(15,40,85,0.04)', textAlign: 'left' }}>
                  {['Name', 'Dept', 'Scheduled', 'In', 'Out', 'Late', 'Status', 'Informed', 'Ded.', 'Remark', 'Override'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => <AttendanceRow key={r.id} row={r} onSaved={() => load(date)} onError={setError} />)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// The biometric machine reports IN on the day's own export, but the OUT for a
// day is only finalised in the NEXT morning's export. So a freshly-uploaded day
// shows IN punches with OUT still "pending" until tomorrow's file lands. This
// banner makes that "yesterday-OUT / today-IN" pairing explicit.
function prevIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function SameDayHeading({ date, rows }: { date: string; rows: Row[] }) {
  const pendingOut = rows.filter(r => r.actualIn && !r.actualOut).length;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '10px 14px', marginBottom: 12, borderRadius: 10,
      background: 'rgba(26,63,126,0.05)', border: '1px solid rgba(26,63,126,0.14)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy-deep, #1A3F7E)' }}>
        Same-day report · {date}
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
        IN punches are from {date}; OUT carries over from each person's previous shift.
        {pendingOut > 0
          ? ` ${pendingOut} row(s) still show OUT as “pending” — they finalise when you upload the ${date} evening / next-morning export.`
          : ' All OUT punches finalised.'}
      </span>
      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-soft)' }}>
        Prev day: {prevIso(date)}
      </span>
    </div>
  );
}

const PENALISED = new Set(['ABSENT', 'HALF_DAY', 'LATE']);

function rowBg(r: Row): string {
  if (r.isInformed) return 'rgba(46,108,84,0.08)';        // green — informed absence
  if (r.status === 'ABSENT') return 'rgba(181,72,61,0.08)'; // red
  if (r.status === 'LATE') return 'rgba(201,164,114,0.12)'; // amber
  if (r.status === 'HALF_DAY') return 'rgba(201,164,114,0.07)';
  return 'transparent';
}

function AttendanceRow({ row, onSaved, onError }: { row: Row; onSaved: () => void; onError: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(row.status);
  const [informed, setInformed] = useState(row.isInformed);
  const [remark, setRemark] = useState(row.remark || '');
  const [actualIn, setActualIn] = useState(hhmm(row.actualIn));
  const [actualOut, setActualOut] = useState(hhmm(row.actualOut));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, any>): Promise<boolean> {
    const r = await fetch('/api/attendance/daily', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, ...body }),
    });
    const d = await r.json();
    if (!d.ok) { onError(d.error || 'Save failed'); return false; }
    return true;
  }

  async function save() {
    setSaving(true);
    // No deductionDays sent — it's derived server-side from the chosen status
    // (the only thing payroll reads). Status / "Excuse as paid" control pay.
    const ok = await patch({
      status, isInformed: informed, remark,
      actualIn, actualOut,
    });
    setSaving(false);
    if (ok) { setEditing(false); onSaved(); }
  }

  // One-click: excuse a penalised day as fully-paid leave.
  async function excuse() {
    setBusy(true);
    const ok = await patch({ excusePaid: true });
    setBusy(false);
    if (ok) onSaved();
  }

  if (editing) {
    return (
      <tr style={{ borderTop: '1px solid rgba(15,40,85,0.06)', background: 'rgba(15,40,85,0.03)' }}>
        <td style={td}><b>{row.name}</b></td>
        <td style={td}>{row.department || '—'}</td>
        <td style={td}>{sched(row)}</td>
        <td style={td}>
          <input style={{ ...inp, width: 84 }} type="time" value={actualIn} onChange={e => setActualIn(e.target.value)} />
        </td>
        <td style={td}>
          <input style={{ ...inp, width: 84 }} type="time" value={actualOut} onChange={e => setActualOut(e.target.value)} />
        </td>
        <td style={td}>{lateLabel(row)}</td>
        <td style={td}>
          <select style={{ ...inp, width: 120 }} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </td>
        <td style={td}>
          <input type="checkbox" checked={informed} onChange={e => setInformed(e.target.checked)} />
        </td>
        <td style={{ ...td, color: 'var(--ink-soft)', fontStyle: 'italic' }}
            title="The deduction is set automatically from the status you pick — pick the status (or use Excuse as paid) to control pay.">auto</td>
        <td style={td}>
          <input style={{ ...inp, width: 150 }} value={remark} placeholder="reason…" onChange={e => setRemark(e.target.value)} />
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>
          <button onClick={save} disabled={saving} style={btnLink}>{saving ? '…' : 'Save'}</button>
          <button onClick={() => setEditing(false)} style={{ ...btnLink, color: 'var(--ink-soft)', marginLeft: 8 }}>Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderTop: '1px solid rgba(15,40,85,0.06)', background: rowBg(row) }}>
      <td style={td}>
        {row.name}
        {row.overridden && <span title={`Overridden by ${row.overrideBy || 'someone'}`} style={pill('muted')}>manual</span>}
      </td>
      <td style={td}>{row.department || '—'}</td>
      <td style={{ ...td, color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums' }}>{sched(row)}</td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{row.actualIn || '—'}</td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{row.actualOut || <span style={{ color: 'var(--ink-soft)' }}>pending</span>}</td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{lateLabel(row)}</td>
      <td style={td}><StatusPill status={row.status} /></td>
      <td style={td}>{row.isInformed ? <span style={pill('sage')}>informed</span> : '—'}</td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{Number(row.deductionDays) > 0 ? Number(row.deductionDays) : '—'}</td>
      <td style={{ ...td, color: 'var(--ink-soft)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.remark || '—'}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <button onClick={() => setEditing(true)} style={btnLink}>Override</button>
        {PENALISED.has(row.status) && !row.isInformed && (
          <button onClick={excuse} disabled={busy} title="Excuse as paid leave (no deduction)"
            style={{ ...btnLink, color: '#2E6C54', marginLeft: 10 }}>
            {busy ? '…' : 'Excuse (paid)'}
          </button>
        )}
      </td>
    </tr>
  );
}

function UploadWidget({ onDone }: { onDone: (datesTouched: string[]) => void }) {
  const todayRef = useRef<HTMLInputElement | null>(null);
  const yestRef = useRef<HTMLInputElement | null>(null);
  const [todayFile, setTodayFile] = useState<File | null>(null);
  const [yestFile, setYestFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);

  async function submit() {
    if (!todayFile && !yestFile) { setErr('Pick at least one file.'); return; }
    setBusy(true); setErr(null); setMsg(null); setSummary(null);
    const fd = new FormData();
    if (todayFile) fd.append('file_today', todayFile);
    if (yestFile) fd.append('file_yesterday', yestFile);
    try {
      const r = await fetch('/api/attendance/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || 'Upload failed'); setBusy(false); return; }
      const s: UploadSummary = d.summary;
      setSummary(s);
      setMsg(`Processed ${s.daysUpserted} record(s) across ${s.dates.join(', ') || '—'}.${s.newEmployees ? ` ${s.newEmployees} new employee(s) created — enrich them in Employees.` : ''}${s.unmatched ? ` ${s.unmatched} row(s) unmatched.` : ''}`);
      setTodayFile(null); setYestFile(null);
      if (todayRef.current) todayRef.current.value = '';
      if (yestRef.current) yestRef.current.value = '';
      onDone(s.dates);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 20, padding: 18, borderRadius: 12, border: '1px solid rgba(15,40,85,0.12)', background: 'rgba(15,40,85,0.025)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Upload biometric export</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Today's file has IN punches only; yesterday's carries the finalised OUT. Each file is read by its own report date — re-uploading a day updates it.
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FilePick label="Today's export" file={todayFile} inputRef={todayRef} onPick={setTodayFile} />
        <FilePick label="Yesterday's export" file={yestFile} inputRef={yestRef} onPick={setYestFile} />
        <button onClick={submit} disabled={busy || (!todayFile && !yestFile)} style={{ ...btnPrimary, opacity: busy || (!todayFile && !yestFile) ? 0.55 : 1 }}>
          {busy ? 'Uploading…' : 'Upload & process'}
        </button>
      </div>
      {err && <div style={{ marginTop: 12 }}><Banner kind="error">{err}</Banner></div>}
      {msg && <div style={{ marginTop: 12 }}><Banner kind="info">{msg}</Banner></div>}
      {summary && summary.files.some(f => f.warnings.length > 0) && (
        <ul style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-soft)', paddingLeft: 18 }}>
          {summary.files.flatMap(f => f.warnings.slice(0, 8).map((w, i) => <li key={`${f.fileName}-${i}`}>{f.fileName}: {w}</li>))}
        </ul>
      )}
    </div>
  );
}

function FilePick({ label, file, inputRef, onPick }: {
  label: string; file: File | null;
  inputRef: React.MutableRefObject<HTMLInputElement | null>; onPick: (f: File | null) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</span>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={e => onPick(e.target.files?.[0] || null)} />
      <button onClick={() => inputRef.current?.click()} style={{ ...btnSecondary, minWidth: 200, textAlign: 'left' }}>
        {file ? file.name : 'Choose file…'}
      </button>
    </div>
  );
}

// ─── small bits ──────────────────────────────────────────────
function sched(r: Row): string {
  return r.scheduledIn && r.scheduledOut ? `${r.scheduledIn}–${r.scheduledOut}` : '—';
}
// "HH:mm:ss" / "HH:mm" → "HH:mm" for <input type="time">; '' when absent.
function hhmm(t: string | null): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}
function lateLabel(r: Row): string {
  if (!r.lateByMin || r.lateByMin <= 0) return '—';
  return `${r.lateByMin}m`;
}
function StatusPill({ status }: { status: string }) {
  const tone: Record<string, 'sage' | 'rust' | 'gold' | 'muted' | 'navy'> = {
    PRESENT: 'sage', ON_DUTY: 'sage', LEAVE: 'navy', SPECIAL_PAID: 'navy',
    HOLIDAY: 'navy', OFF_DAY: 'muted', LATE: 'gold', HALF_DAY: 'gold', ABSENT: 'rust',
  };
  return <span style={{ ...pill(tone[status] || 'muted'), marginLeft: 0 }}>{STATUS_LABEL[status] || status}</span>;
}
function Banner({ kind, children }: { kind: 'error' | 'info'; children: React.ReactNode }) {
  const isErr = kind === 'error';
  return <div style={{ padding: '11px 15px', borderRadius: 10, fontSize: 13, color: isErr ? 'var(--rust, #B5483D)' : 'var(--navy-deep, #1A3F7E)', background: isErr ? 'rgba(181,72,61,0.08)' : 'rgba(15,40,85,0.05)', border: `1px solid ${isErr ? 'rgba(181,72,61,0.25)' : 'rgba(15,40,85,0.15)'}` }}>{children}</div>;
}
const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const td: React.CSSProperties = { padding: '9px 12px', color: 'var(--ink)' };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,40,85,0.2)', fontSize: 13, boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, background: '#fff', color: 'var(--ink)', border: '1px solid rgba(15,40,85,0.22)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 };
const btnLink: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--navy-deep, #1A3F7E)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 };
function pill(tone: 'sage' | 'rust' | 'gold' | 'muted' | 'navy'): React.CSSProperties {
  const map = {
    sage: ['rgba(46,108,84,0.12)', '#2E6C54'],
    rust: ['rgba(181,72,61,0.12)', '#B5483D'],
    gold: ['rgba(201,164,114,0.18)', '#9A7634'],
    muted: ['rgba(15,40,85,0.08)', 'var(--ink-soft)'],
    navy: ['rgba(15,40,85,0.10)', 'var(--navy-deep, #1A3F7E)'],
  }[tone];
  return { marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: map[0], color: map[1], display: 'inline-block' };
}
