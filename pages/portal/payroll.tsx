// ============================================================
// /portal/payroll — monthly salary run (owner / admin / hr).
// ============================================================
// Pick a month → see each employee's computed payslip (calendar-day
// divisor, half-days, LWP, late-tiering, leave cap, advance). The
// numbers are a live PREVIEW until you press "Finalize month", which
// locks the snapshot and records advance deductions. Finalized rows
// show a lock and can't drift.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Result = {
  daysInMonth: number; presentDays: number; halfDays: number;
  paidLeaves: number; excessLeaves: number; lwpDays: number;
  paidHolidays: number; weeklyOffs: number; onDutyDays: number;
  lateCount: number; lateDeductionDays: number; deductionDays: number;
  netPayableDays: number; perDaySalary: number; grossSalary: number;
  advanceDeduction: number; netSalary: number;
};
type Row = {
  employeeId: string; name: string; hrCode: string;
  department: string | null; designation: string | null;
  monthlySalary: number; finalized: boolean; result: Result; leaveBalance: number;
};

const INR = (n: number) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollPage() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [daysInMonth, setDaysInMonth] = useState(0);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    setLoading(true); setMsg(null);
    fetch(`/api/attendance/payroll?month=${encodeURIComponent(month)}`)
      .then(r => { if (r.status === 403) { setDenied(true); return null; } return r.json(); })
      .then(r => {
        if (!r) return;
        if (r.ok) { setRows(r.rows); setDaysInMonth(r.daysInMonth); }
      })
      .catch(() => setMsg('Could not load payroll.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [month]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.gross += r.result.grossSalary;
      acc.advance += r.result.advanceDeduction;
      acc.net += r.result.netSalary;
      return acc;
    }, { gross: 0, advance: 0, net: 0 });
  }, [rows]);

  const openCount = rows.filter(r => !r.finalized).length;

  async function finalizeMonth() {
    if (!confirm(`Finalize payroll for ${month}? This locks ${openCount} open payslip(s) and records advance deductions. Already-finalized employees are skipped.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/attendance/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, action: 'finalize' }),
      }).then(x => x.json());
      if (r.ok) { setMsg(`Finalized ${r.finalized}, skipped ${r.skipped}.`); load(); }
      else setMsg(r.error || 'Finalize failed.');
    } catch { setMsg('Finalize failed.'); }
    finally { setBusy(false); }
  }

  if (denied) {
    return (
      <AppShell title="Payroll" crumb="HR">
        <div style={{ padding: 32, color: 'var(--rust)' }}>Not authorised.</div>
      </AppShell>
    );
  }

  const th: React.CSSProperties = {
    textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700,
    letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)',
    borderBottom: '1px solid rgba(15,40,85,0.1)', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    textAlign: 'right', padding: '8px 10px', fontSize: 13,
    color: 'var(--ink, #0F2855)', borderBottom: '1px solid rgba(15,40,85,0.05)',
  };

  return (
    <AppShell title="Payroll" crumb="HR · Salary">
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 4px 24px' }}>
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
            {daysInMonth} calendar days · {rows.length} employees · {openCount} open
          </span>
          <div style={{ flex: 1 }} />
          {msg && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{msg}</span>}
          <button onClick={finalizeMonth} disabled={busy || openCount === 0} style={{
            fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: openCount === 0 ? 'default' : 'pointer',
            border: 'none', color: '#fff', fontFamily: 'inherit',
            background: openCount === 0 ? 'rgba(15,40,85,0.25)' : 'var(--gold-deep, #B58430)',
            opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Finalizing…' : `Finalize month`}
          </button>
        </div>

        {/* Totals strip */}
        <div style={{ display: 'flex', gap: 24, padding: '12px 16px', marginBottom: 14, background: '#fff',
          border: '1px solid rgba(15,40,85,0.1)', borderRadius: 12 }}>
          <Stat label="Gross payroll" value={INR(totals.gross)} />
          <Stat label="Advance recovered" value={INR(totals.advance)} />
          <Stat label="Net payable" value={INR(totals.net)} strong />
        </div>

        <div style={{ background: '#fff', border: '1px solid rgba(15,40,85,0.1)', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Employee</th>
                <th style={th}>Present</th>
                <th style={th}>Half</th>
                <th style={th}>Leave (bal)</th>
                <th style={th}>LWP</th>
                <th style={th}>Late</th>
                <th style={th}>Off/Hol</th>
                <th style={th}>Payable days</th>
                <th style={th}>Per day</th>
                <th style={th}>Gross</th>
                <th style={th}>Advance</th>
                <th style={th}>Net</th>
                <th style={th}> </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={13} style={{ ...td, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={13} style={{ ...td, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No employees / no attendance for this month.</td></tr>
              )}
              {rows.map(r => {
                const x = r.result;
                return (
                  <tr key={r.employeeId}>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                        {r.hrCode}{r.department ? ` · ${r.department}` : ''} · {INR(r.monthlySalary)}/mo
                      </div>
                    </td>
                    <td style={td}>{x.presentDays}</td>
                    <td style={td}>{x.halfDays || '—'}</td>
                    <td style={td}>
                      {x.paidLeaves || '—'}
                      {x.excessLeaves ? <span style={{ color: 'var(--rust, #B4502E)' }}> +{x.excessLeaves} LWP</span> : null}
                      <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}> ({r.leaveBalance} left)</span>
                    </td>
                    <td style={{ ...td, color: x.lwpDays ? 'var(--rust, #B4502E)' : undefined }}>{x.lwpDays || '—'}</td>
                    <td style={td}>
                      {x.lateCount || '—'}
                      {x.lateDeductionDays ? <span style={{ color: 'var(--rust, #B4502E)' }}> −{x.lateDeductionDays}d</span> : null}
                    </td>
                    <td style={td}>{(x.weeklyOffs + x.paidHolidays) || '—'}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{x.netPayableDays}</td>
                    <td style={td}>{INR(x.perDaySalary)}</td>
                    <td style={td}>{INR(x.grossSalary)}</td>
                    <td style={{ ...td, color: x.advanceDeduction ? 'var(--rust, #B4502E)' : undefined }}>{x.advanceDeduction ? `−${INR(x.advanceDeduction)}` : '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{INR(x.netSalary)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {r.finalized
                        ? <span title="Finalized" style={{ color: 'var(--gold-deep, #B58430)' }}>🔒</span>
                        : <span title="Open (preview)" style={{ color: 'var(--ink-soft)', fontSize: 11 }}>open</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          Per-day salary = monthly salary ÷ calendar days. Half-day = −0.5, absent/LWP = −1.
          First 3 lates/month free, then −0.25 each. Paid leaves capped at 18/year (+carry-over); the rest become LWP.
          Numbers are a live preview until finalized.
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: strong ? 22 : 18, fontWeight: strong ? 800 : 600, color: strong ? 'var(--gold-deep, #B58430)' : 'var(--ink, #0F2855)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
