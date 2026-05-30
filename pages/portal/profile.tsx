// ============================================================
// /portal/profile — My Profile (personal HR records).
// ============================================================
// Every user's detailed view of their own:
//   • Identity (name, exec ID, role, email)
//   • Attendance breakdown
//   • Leave history + balance
//   • Advance ledger
//   • Monthly installments
//   • Documents
// Real data where we have it (identity, activity); HR-side fields
// render as a "pending HR system" treatment until the HR system
// is integrated.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import MyAttendancePanel from '../../components/MyAttendancePanel';

type Data = {
  ok: true;
  profile: { name: string; execId: string; role: string; email: string | null; lastLoginAt: string | null };
  activity: { todaySec: number; weekSec: number; monthSec: number; consistencyPct: number; monthActiveDays: number; businessDays: number };
  hr: {
    placeholder: true;
    leavesTotal: number; leavesUsed: number | null; leavesRemaining: number | null;
    presentDaysThisMonth: number | null; absentDaysThisMonth: number | null;
    paidLeavesThisMonth: number | null;
    advanceBalance: number | null; activeInstalments: number | null;
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

export default function ProfilePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me/dashboard')
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed'); setData(r); })
      .catch(e => setError(e.message));
  }, []);

  if (error) return <AppShell title="My Profile" crumb="Personal · Records"><div style={{ padding: 32, color: 'var(--rust)' }}>Failed: {error}</div></AppShell>;
  if (!data) return <AppShell title="My Profile" crumb="Personal · Records"><div style={{ padding: 32, color: 'var(--ink-soft)' }}>Loading…</div></AppShell>;

  const p = data.profile;
  const hr = data.hr;
  const initials = (p.name || '?').split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <AppShell title="My Profile" crumb="Personal · Records">
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 4px 60px' }}>
        {/* Identity card */}
        <div style={{
          padding: '24px 28px', marginBottom: 22,
          background: 'linear-gradient(160deg, #1A3F7E, #0F2855)',
          borderRadius: 14,
          display: 'grid', gridTemplateColumns: '76px 1fr', gap: 22, alignItems: 'center',
          boxShadow: '0 20px 50px rgba(15,40,85,0.18)',
        }}>
          <div style={{
            width: 76, height: 76, borderRadius: 999,
            background: 'rgba(255,255,255,0.10)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 30, fontWeight: 700, letterSpacing: '.02em',
            border: '2px solid rgba(201,164,114,0.30)',
          }}>{initials}</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-.01em' }}>{p.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span><b style={{ color: '#fff' }}>{p.execId}</b></span>
              <span>Role: <b style={{ color: '#fff' }}>{p.role}</b></span>
              {p.email && <span>Email: <b style={{ color: '#fff' }}>{p.email}</b></span>}
            </div>
            {p.lastLoginAt && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 8 }}>
                Last sign-in {new Date(p.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}
              </div>
            )}
          </div>
        </div>

        {/* Attendance — live from the attendance module */}
        <div style={{ marginBottom: 18 }}>
          <Section title="Attendance · this month">
            <MyAttendancePanel mode="detail" />
          </Section>
        </div>

        {/* Two-column body */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
          {/* Work activity (portal usage) */}
          <Section title="Work activity · this month">
            <KV label="Business days so far" value={data.activity.businessDays} real />
            <KV label="You worked"          value={`${data.activity.monthActiveDays} days`} real />
            <KV label="Active time"         value={fmtHM(data.activity.monthSec)} real />
            <KV label="Consistency"         value={`${data.activity.consistencyPct}%`} real accent={data.activity.consistencyPct >= 80 ? 'sage' : data.activity.consistencyPct >= 60 ? 'amber' : 'rust'} />
          </Section>

          {/* Leave balance */}
          <Section title="Leave balance" pendingHR>
            <KV label="Annual entitlement" value={`${hr.leavesTotal} days`} real />
            <KV label="Used this year"     value={hr.leavesUsed} />
            <KV label="Remaining"          value={hr.leavesRemaining} accent="sage" />
            <Hr />
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, fontStyle: 'italic', marginTop: 8 }}>
              Leave history table appears here once HR is integrated. You'll be able to request leaves, see approval status, and view past records.
            </div>
          </Section>
        </div>

        {/* Advances + Installments */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
          <Section title="Advance ledger" pendingHR>
            <KV label="Outstanding advance" value={hr.advanceBalance != null ? `₹${hr.advanceBalance.toLocaleString('en-IN')}` : null} />
            <KV label="Active deductions" value={null} />
            <Hr />
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, fontStyle: 'italic', marginTop: 8 }}>
              Itemised advance history appears here once HR is integrated — when each advance was issued, how much has been deducted, the running balance.
            </div>
          </Section>

          <Section title="Monthly installments" pendingHR>
            <KV label="Active installments" value={hr.activeInstalments} />
            <KV label="Total monthly deduction" value={null} />
            <Hr />
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, fontStyle: 'italic', marginTop: 8 }}>
              Installment schedule appears here once HR is integrated — start date, total amount, EMI, months remaining.
            </div>
          </Section>
        </div>

        {/* Documents */}
        <Section title="Documents" pendingHR>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Once the HR system is live this section will hold your offer letter, ID card, salary slips,
            and any other documents shared by HR. You'll also be able to upload personal documents
            (ID proof, address proof, bank passbook) for HR records.
          </div>
        </Section>
      </div>
    </AppShell>
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

function KV({ label, value, accent, real }: { label: string; value: string | number | null | undefined; accent?: 'sage' | 'rust' | 'amber'; real?: boolean }) {
  const color = accent === 'sage' ? 'var(--sage, #2E6C54)'
              : accent === 'rust' ? 'var(--rust, #B5483D)'
              : accent === 'amber' ? 'var(--amber, #B58430)'
              : 'var(--ink)';
  const display = value == null || value === '' ? '—' : String(value);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 0' }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
        {label}
        {real && <span style={{ marginLeft: 6, fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--sage, #2E6C54)' }}>LIVE</span>}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 600,
        color: value == null ? 'rgba(15,40,85,0.30)' : color,
        fontVariantNumeric: 'tabular-nums',
      }}>{display}</span>
    </div>
  );
}

function Hr() {
  return <hr style={{ border: 'none', borderTop: '1px solid rgba(15,40,85,0.08)', margin: '10px 0' }} />;
}
