// ============================================================
// /portal/overtime — the month-end overtime sheet (owner / admin / hr).
// ============================================================
// Pick a month → every employee who worked a weekly-off or holiday that
// month, with their count of overtime DAYS (and the exact dates). This is
// the "separate sheet" that sits alongside Payroll: the day stays PAID as
// off/holiday — overtime here is purely a count of extra days worked, for
// you to reward / give comp-off as you see fit.
//
// "Download sheet" exports a clean CSV (Name, HR Code, Dept, OT Days,
// Dates) you can open in Excel or print.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type OtDay = { date: string; status: string };
type Row = {
  employeeId: string; name: string; hrCode: string;
  department: string | null; otDays: number; dates: OtDay[];
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "2026-06-14" → "14 Jun" for compact display.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MON[m - 1]}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MON[m - 1]} ${y}`;
}

export default function OvertimePage() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    setLoading(true); setMsg(null);
    fetch(`/api/attendance/overtime?month=${encodeURIComponent(month)}`)
      .then(r => { if (r.status === 403) { setDenied(true); return null; } return r.json(); })
      .then(r => {
        if (!r) return;
        if (r.ok) { setRows(r.rows); setTotal(r.totalOtDays); }
        else setMsg(r.error || 'Could not load overtime.');
      })
      .catch(() => setMsg('Could not load overtime.'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [month]);

  const empCount = rows.length;
  const csvName = useMemo(() => `overtime-${month}.csv`, [month]);

  function downloadSheet() {
    const head = ['Name', 'HR Code', 'Department', 'OT Days', 'Dates'];
    const lines = rows.map(r => [
      r.name,
      r.hrCode,
      r.department || '',
      String(r.otDays),
      r.dates.map(d => dayLabel(d.date)).join('; '),
    ].map(csvCell).join(','));
    const csv = [head.join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = csvName; a.click();
    URL.revokeObjectURL(url);
  }

  if (denied) {
    return (
      <AppShell title="Overtime" crumb="HR">
        <div style={{ padding: 32, color: 'var(--rust)' }}>Not authorised.</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Overtime" crumb="HR · Overtime">
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 4px 24px' }}>
        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            Month{' '}
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{
              fontSize: 13, padding: '6px 9px', border: '1px solid rgba(15,40,85,0.16)',
              borderRadius: 8, fontFamily: 'inherit', color: 'var(--ink)',
            }} />
          </label>
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {empCount} employee{empCount === 1 ? '' : 's'} · {total} overtime day{total === 1 ? '' : 's'}
          </span>
          <div style={{ flex: 1 }} />
          {msg && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{msg}</span>}
          <button onClick={downloadSheet} disabled={rows.length === 0} style={{
            fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8,
            cursor: rows.length === 0 ? 'default' : 'pointer', border: 'none', color: '#fff',
            fontFamily: 'inherit', background: rows.length === 0 ? 'rgba(15,40,85,0.25)' : 'var(--gold-deep, #B58430)',
          }}>
            Download sheet
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 14, lineHeight: 1.6 }}>
          Overtime = a day worked on a <b>weekly-off</b> or <b>holiday</b>. The day is still paid as
          off/holiday in Payroll; this sheet just counts the extra days each person came in for {monthLabel(month)}.
        </div>

        <div style={{ background: '#fff', border: '1px solid rgba(15,40,85,0.1)', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Employee</th>
                <th style={{ ...th, textAlign: 'left' }}>Department</th>
                <th style={th}>OT Days</th>
                <th style={{ ...th, textAlign: 'left' }}>Dates worked</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No overtime in {monthLabel(month)} — nobody worked a weekly-off or holiday.</td></tr>
              )}
              {rows.map(r => (
                <tr key={r.employeeId}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.hrCode}</div>
                  </td>
                  <td style={{ ...td, textAlign: 'left', color: 'var(--ink-soft)' }}>{r.department || '—'}</td>
                  <td style={{ ...td, fontWeight: 700, fontSize: 15 }}>{r.otDays}</td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {r.dates.map(d => (
                        <span key={d.date} title={d.status === 'HOLIDAY' ? 'Holiday' : 'Weekly-off'} style={{
                          fontSize: 11.5, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                          background: d.status === 'HOLIDAY' ? 'rgba(201,164,114,0.18)' : 'rgba(46,108,84,0.12)',
                          color: d.status === 'HOLIDAY' ? '#9A7634' : '#2E6C54',
                        }}>
                          {dayLabel(d.date)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

// CSV-escape a cell (quote if it contains comma / quote / newline).
function csvCell(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const th: React.CSSProperties = {
  textAlign: 'right', padding: '8px 12px', fontSize: 11, fontWeight: 700,
  letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)',
  borderBottom: '1px solid rgba(15,40,85,0.1)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  textAlign: 'right', padding: '10px 12px', fontSize: 13,
  color: 'var(--ink, #0F2855)', borderBottom: '1px solid rgba(15,40,85,0.05)',
  verticalAlign: 'top',
};
