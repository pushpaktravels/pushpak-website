// ============================================================
// /portal — Personal Dashboard (default landing for every user).
// ============================================================
// Shows the signed-in user's own working stats, attendance summary,
// leave balance, consistency, and performance. Activity numbers
// (today / week / month) come from the real ActivityDay table;
// HR fields render as placeholders pending the HR system rollout.
//
// The previous accounts-focused dashboard is now at /portal/followup.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import MyAttendancePanel from '../components/MyAttendancePanel';

type Daily = { date: string; sec: number };
type Data = {
  ok: true;
  profile: { name: string; execId: string; role: string; email: string | null; lastLoginAt: string | null };
  activity: {
    todaySec: number; weekSec: number; monthSec: number;
    lastPingAt: string | null;
    monthActiveDays: number; businessDays: number; consistencyPct: number;
    daily: Daily[];
  };
  performance: {
    monthPoints: number; totalPoints: number;
    monthEvents: number; monthActions: number;
  };
  hr: {
    placeholder: true;
    leavesTotal: number;
    leavesUsed: number | null;
    leavesRemaining: number | null;
    presentDaysThisMonth: number | null;
    absentDaysThisMonth: number | null;
    paidLeavesThisMonth: number | null;
    advanceBalance: number | null;
    activeInstalments: number | null;
  };
};

function fmtHM(sec: number): string {
  if (!sec || sec <= 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function greet(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function PersonalDashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me/dashboard')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setData(r);
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) return <AppShell title="Dashboard" crumb="Personal · Overview"><div style={{ padding: 32, color: 'var(--rust)' }}>Failed: {error}</div></AppShell>;
  if (!data) return <AppShell title="Dashboard" crumb="Personal · Overview"><div style={{ padding: 32, color: 'var(--ink-soft)' }}>Loading…</div></AppShell>;

  const p = data.profile;
  const a = data.activity;
  const perf = data.performance;
  const hr = data.hr;
  const dailyMax = Math.max(1, ...a.daily.map(d => d.sec));

  return (
    <AppShell title="Dashboard" crumb="Personal · Overview">
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 4px 60px' }}>
        {/* Greeting */}
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 12, letterSpacing: '.28em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700, marginBottom: 6 }}>
            {greet()},
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-.014em' }}>
            {p.name}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6 }}>
            {p.execId} · {p.role}
            {p.lastLoginAt && <> · Last sign-in {new Date(p.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</>}
          </div>
        </div>

        {/* Top stat strip — activity & leaves */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
          <StatCard label="Today" value={fmtHM(a.todaySec)} sub="active time" />
          <StatCard label="This week" value={fmtHM(a.weekSec)} sub="rolling 7 days" />
          <StatCard label="This month" value={fmtHM(a.monthSec)} sub={`${a.monthActiveDays} days worked`} />
          <StatCard label="Consistency" value={`${a.consistencyPct}%`} sub={`${a.monthActiveDays}/${a.businessDays} business days`} accent={a.consistencyPct >= 80 ? 'sage' : a.consistencyPct >= 60 ? 'amber' : 'rust'} />
          <StatCard
            label="Leaves remaining"
            value={hr.leavesRemaining != null ? `${hr.leavesRemaining}` : `${hr.leavesTotal}`}
            sub={hr.leavesRemaining != null ? `of ${hr.leavesTotal} per year` : `${hr.leavesTotal} per year · HR pending`}
            placeholder={hr.leavesRemaining == null}
          />
        </div>

        {/* Two-column body */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18, marginBottom: 18 }}>
          {/* Daily activity chart */}
          <Section title="Your daily activity · last 14 days">
            {a.daily.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic', padding: '18px 0' }}>
                No activity recorded yet. As you use the portal, working minutes accumulate here.
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
                {a.daily.map(d => {
                  const pct = d.sec / dailyMax;
                  return (
                    <div key={d.date} title={`${d.date}: ${fmtHM(d.sec)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                      <div style={{ width: '100%', height: `${Math.max(2, pct * 100)}%`, background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', borderRadius: '4px 4px 0 0' }} />
                      <div style={{ fontSize: 9.5, color: 'var(--ink-soft)', marginTop: 6 }}>{new Date(d.date).getDate()}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Performance card */}
          <Section title="Performance this month">
            <Row label="Actions logged"  value={`${perf.monthActions}`} />
            <Row label="Point events"    value={`${perf.monthEvents}`} />
            <Row label="Points earned"   value={`${perf.monthPoints}`} accent={perf.monthPoints >= 0 ? 'sage' : 'rust'} />
            <hr style={{ border: 'none', borderTop: '1px solid rgba(15,40,85,0.08)', margin: '12px 0' }} />
            <Row label="Lifetime points" value={`${perf.totalPoints}`} bold />
          </Section>
        </div>

        {/* Attendance summary — live from the attendance module */}
        <div style={{ marginTop: 2 }}>
          <MyAttendancePanel mode="summary" />
        </div>

        {/* Advances + Installments (placeholder) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
          <Section title="Advance balance" pendingHR>
            <Mini label="Outstanding advance" value={hr.advanceBalance != null ? `₹${hr.advanceBalance.toLocaleString('en-IN')}` : null} />
          </Section>
          <Section title="Monthly installments" pendingHR>
            <Mini label="Active installments" value={hr.activeInstalments} />
          </Section>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Bits ───────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, placeholder }: { label: string; value: string; sub?: string; accent?: 'sage' | 'amber' | 'rust'; placeholder?: boolean }) {
  const color = accent === 'sage' ? 'var(--sage, #2E6C54)'
              : accent === 'amber' ? 'var(--amber, #B58430)'
              : accent === 'rust' ? 'var(--rust, #B5483D)'
              : 'var(--ink)';
  return (
    <div style={{
      padding: '18px 20px',
      background: placeholder ? 'rgba(217,165,69,0.06)' : 'rgba(255,255,255,0.65)',
      border: placeholder ? '1px dashed rgba(217,165,69,0.40)' : '1px solid rgba(15,40,85,0.10)',
      borderRadius: 12, minHeight: 100,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 8, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children, pendingHR }: { title: string; children: React.ReactNode; pendingHR?: boolean }) {
  return (
    <div style={{
      padding: '20px 22px',
      background: pendingHR ? 'rgba(217,165,69,0.05)' : 'rgba(255,255,255,0.65)',
      border: pendingHR ? '1px dashed rgba(217,165,69,0.30)' : '1px solid rgba(15,40,85,0.10)',
      borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700 }}>{title}</div>
        {pendingHR && (
          <span style={{
            fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700,
            padding: '3px 8px', borderRadius: 4,
            background: 'rgba(217,165,69,0.18)', color: 'var(--amber, #B58430)',
          }}>HR system pending</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, accent, bold }: { label: string; value: string; accent?: 'sage' | 'rust'; bold?: boolean }) {
  const color = accent === 'sage' ? 'var(--sage, #2E6C54)' : accent === 'rust' ? 'var(--rust, #B5483D)' : 'var(--ink)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{label}</span>
      <span style={{ fontSize: bold ? 16 : 14, fontWeight: bold ? 700 : 600, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string | number | null; accent?: 'rust' | 'sage' }) {
  const color = accent === 'rust' ? 'var(--rust, #B5483D)' : accent === 'sage' ? 'var(--sage, #2E6C54)' : 'var(--ink)';
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: value == null ? 'rgba(15,40,85,0.30)' : color, fontVariantNumeric: 'tabular-nums' }}>
        {value == null ? '—' : value}
      </div>
    </div>
  );
}
