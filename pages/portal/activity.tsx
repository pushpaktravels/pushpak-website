// ============================================================
// /portal/activity — owner-only active-time report.
// ============================================================
// Per-user totals (today / week / month / range) + daily chart +
// top pages by minutes spent + XLSX export. "Live" indicator
// (green dot) for any user whose last ping was within 2 minutes.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { ExportButton } from '../../components/ExportButton';
import { SortableTh, useSort } from '../../components/SortableTh';

type UserRow = {
  userId: string; userName: string; execId: string; role: string;
  totalSec: number; todaySec: number; weekSec: number; monthSec: number;
  lastPingAt: string | null;
  online: boolean;
};
type DailyRow = { date: string; totalSec: number };
type PageRow  = { page: string; totalSec: number };

type SortKey = 'name' | 'role' | 'today' | 'week' | 'month' | 'total' | 'lastPing';

function fmtHM(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function fmtRel(iso: string | null): string {
  if (!iso) return '—';
  const d = Date.now() - +new Date(iso);
  if (d < 60_000)        return 'just now';
  if (d < 3600_000)      return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)    return `${Math.floor(d / 3600_000)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

const PRESETS = [
  { key: '7d',   label: 'Last 7 days',  days: 6 },
  { key: '30d',  label: 'Last 30 days', days: 29 },
  { key: 'mtd',  label: 'Month to date' },
  { key: 'ytd',  label: 'Year to date'  },
] as const;
type Preset = typeof PRESETS[number]['key'];

export default function ActivityPage() {
  return (
    <AppShell title="Activity & Time Tracking" crumb="Admin · Activity">
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const [perUser, setPerUser] = useState<UserRow[]>([]);
  const [daily, setDaily]     = useState<DailyRow[]>([]);
  const [pages, setPages]     = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [preset, setPreset]   = useState<Preset>('30d');
  const [since, setSince]     = useState<string>('');
  const [until, setUntil]     = useState<string>('');

  function applyPreset(p: Preset) {
    setPreset(p);
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth();
    if (p === '7d')      { setSince(new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10)); setUntil(''); }
    else if (p === '30d'){ setSince(new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10)); setUntil(''); }
    else if (p === 'mtd'){ setSince(new Date(y, m, 1).toISOString().slice(0, 10)); setUntil(''); }
    else if (p === 'ytd'){ setSince(new Date(y, 0, 1).toISOString().slice(0, 10)); setUntil(''); }
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      const q = new URLSearchParams();
      if (since) q.set('since', since);
      if (until) q.set('until', until);
      const r = await fetch(`/api/activity/report?${q}`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      setPerUser(r.perUser || []);
      setDaily(r.daily || []);
      setPages(r.pages || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Default to 30d on mount + when filters change
  useEffect(() => { applyPreset('30d'); /* eslint-disable-next-line */ }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [since, until]);

  // Auto-refresh every 60s so the "online" indicator stays fresh
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(id);
  }, [since, until]);

  const sortCtl = useSort<UserRow, SortKey>('total', 'desc', {
    name:     u => u.userName.toLowerCase(),
    role:     u => u.role,
    today:    u => u.todaySec,
    week:     u => u.weekSec,
    month:    u => u.monthSec,
    total:    u => u.totalSec,
    lastPing: u => u.lastPingAt ? +new Date(u.lastPingAt) : 0,
  });
  const sortedUsers = useMemo(() => sortCtl.sort(perUser), [perUser, sortCtl.key, sortCtl.dir]);

  // ── Daily chart bounds ──
  const dailyMax = Math.max(1, ...daily.map(d => d.totalSec));
  const onlineCount = sortedUsers.filter(u => u.online).length;
  const totalActiveToday = sortedUsers.reduce((s, u) => s + u.todaySec, 0);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Activity & Time Tracking</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.5, maxWidth: 820 }}>
          Time recorded only while the portal tab is <b>visible</b> AND there's been keyboard / mouse / scroll activity within the last 90 seconds. Walking away or switching tabs pauses the clock automatically.
        </p>
      </div>

      {/* Top stat strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 12, marginBottom: 18,
      }}>
        <StatCard label="Online now"           value={String(onlineCount)} sub="last ping ≤ 2 min ago" accent={onlineCount > 0 ? 'sage' : undefined} />
        <StatCard label="Active time today"    value={fmtHM(totalActiveToday)} sub="across all users" />
        <StatCard label="Total in range"       value={fmtHM(sortedUsers.reduce((s, u) => s + u.totalSec, 0))} sub={`${since || '—'} → ${until || 'today'}`} />
        <StatCard label="Users tracked"        value={String(sortedUsers.length)} sub="active members" />
      </div>

      {/* Preset chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)} style={{
            padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
            background: preset === p.key ? 'var(--navy-deep, #0F2855)' : 'transparent',
            color: preset === p.key ? '#fff' : 'var(--ink)',
            border: preset === p.key ? '1px solid var(--navy-deep, #0F2855)' : '1px solid rgba(15,40,85,0.22)',
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
            fontFamily: 'inherit',
          }}>{p.label}</button>
        ))}
        <input type="date" value={since} onChange={e => { setSince(e.target.value); setPreset('30d'); }}
          style={inputStyle} title="Since (override preset)" />
        <input type="date" value={until} onChange={e => { setUntil(e.target.value); }}
          style={inputStyle} title="Until (blank = today)" />
        <div style={{ marginLeft: 'auto' }}>
          <ExportButton
            fileName="activity-report"
            rows={sortedUsers}
            columns={[
              { header: 'Name',         get: u => u.userName },
              { header: 'Exec ID',      get: u => u.execId },
              { header: 'Role',         get: u => u.role },
              { header: 'Today (sec)',  get: u => u.todaySec, numeric: true },
              { header: 'Today',        get: u => fmtHM(u.todaySec) },
              { header: 'Week (sec)',   get: u => u.weekSec, numeric: true },
              { header: 'Week',         get: u => fmtHM(u.weekSec) },
              { header: 'Month (sec)',  get: u => u.monthSec, numeric: true },
              { header: 'Month',        get: u => fmtHM(u.monthSec) },
              { header: 'Total (sec)',  get: u => u.totalSec, numeric: true },
              { header: 'Range Total',  get: u => fmtHM(u.totalSec) },
              { header: 'Last seen',    get: u => u.lastPingAt || '' },
            ]}
          />
        </div>
      </div>

      {error && <div style={{ padding: 12, marginBottom: 14, color: 'var(--rust)' }}>Failed: {error}</div>}

      {/* Daily chart */}
      <div style={{
        background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(15,40,85,0.10)',
        borderRadius: 12, padding: '18px 22px', marginBottom: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700 }}>
            Daily total · all users
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{daily.length} day{daily.length === 1 ? '' : 's'}</div>
        </div>
        {daily.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic', padding: '14px 0' }}>
            No activity recorded yet in this range.
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
            {daily.map(d => {
              const pct = d.totalSec / dailyMax;
              const hours = d.totalSec / 3600;
              return (
                <div key={d.date} title={`${d.date}: ${fmtHM(d.totalSec)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                  <div style={{
                    width: '100%',
                    height: `${Math.max(2, pct * 100)}%`,
                    background: 'linear-gradient(180deg,#1A3F7E,#0F2855)',
                    borderRadius: '4px 4px 0 0',
                  }} />
                  <div style={{ fontSize: 9, color: 'var(--ink-soft)', marginTop: 4, whiteSpace: 'nowrap' }}>
                    {new Date(d.date).getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-user table */}
      <div style={{
        background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(15,40,85,0.10)',
        borderRadius: 12, overflow: 'hidden', marginBottom: 18,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(15,40,85,0.04)', borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
              <Th width="14">{' '}</Th>
              <SortableTh field="name"     active={sortCtl.key === 'name'}     dir={sortCtl.dir} onSort={sortCtl.toggle}>User</SortableTh>
              <SortableTh field="role"     active={sortCtl.key === 'role'}     dir={sortCtl.dir} onSort={sortCtl.toggle}>Role</SortableTh>
              <SortableTh field="today"    active={sortCtl.key === 'today'}    dir={sortCtl.dir} onSort={sortCtl.toggle} align="right">Today</SortableTh>
              <SortableTh field="week"     active={sortCtl.key === 'week'}     dir={sortCtl.dir} onSort={sortCtl.toggle} align="right">This week</SortableTh>
              <SortableTh field="month"    active={sortCtl.key === 'month'}    dir={sortCtl.dir} onSort={sortCtl.toggle} align="right">This month</SortableTh>
              <SortableTh field="total"    active={sortCtl.key === 'total'}    dir={sortCtl.dir} onSort={sortCtl.toggle} align="right">Range total</SortableTh>
              <SortableTh field="lastPing" active={sortCtl.key === 'lastPing'} dir={sortCtl.dir} onSort={sortCtl.toggle}>Last seen</SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading && sortedUsers.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)' }}>Loading…</td></tr>
            )}
            {!loading && sortedUsers.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                No tracked users yet. Activity is recorded as people use the portal.
              </td></tr>
            )}
            {sortedUsers.map(u => (
              <tr key={u.userId} style={{ borderBottom: '1px solid rgba(15,40,85,0.04)' }}>
                <Td>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: 999,
                    background: u.online ? 'var(--sage, #2E6C54)' : 'rgba(15,40,85,0.18)',
                    boxShadow: u.online ? '0 0 8px rgba(46,108,84,.45)' : 'none',
                  }} title={u.online ? 'Online now' : 'Offline'} />
                </Td>
                <Td>
                  <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{u.userName}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{u.execId}</div>
                </Td>
                <Td><RolePill role={u.role} /></Td>
                <Td align="right" mono>{fmtHM(u.todaySec)}</Td>
                <Td align="right" mono>{fmtHM(u.weekSec)}</Td>
                <Td align="right" mono>{fmtHM(u.monthSec)}</Td>
                <Td align="right" mono><b>{fmtHM(u.totalSec)}</b></Td>
                <Td>{fmtRel(u.lastPingAt)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Page breakdown */}
      {pages.length > 0 && (
        <div style={{
          background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(15,40,85,0.10)',
          borderRadius: 12, padding: '18px 22px',
        }}>
          <div style={{ fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700, marginBottom: 12 }}>
            Time per page · top 12
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pages.map(p => {
              const max = Math.max(1, ...pages.map(x => x.totalSec));
              const pct = p.totalSec / max;
              return (
                <div key={p.page} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 100px', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {prettyPage(p.page)}
                  </div>
                  <div style={{ height: 8, background: 'rgba(15,40,85,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.max(2, pct * 100)}%`, height: '100%',
                      background: 'linear-gradient(90deg,#1A3F7E,#0F2855)',
                    }} />
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                    {fmtHM(p.totalSec)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function prettyPage(p: string): string {
  if (!p) return '/';
  return p
    .replace(/^\/portal\/?/, '')
    .replace(/\[(\w+)\]/g, ':$1')
    .replace(/^$/, 'Dashboard');
}

function RolePill({ role }: { role: string }) {
  const map: Record<string, string> = {
    owner: 'rgba(217,165,69,.18)',
    admin: 'rgba(15,40,85,.10)',
    cm:    'rgba(46,108,84,.12)',
    exec:  'rgba(15,40,85,.06)',
    analyst: 'rgba(120,130,150,.16)',
  };
  return <span style={{
    background: map[role] || 'rgba(15,40,85,.06)',
    color: 'var(--ink)',
    fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
    padding: '3px 8px', borderRadius: 4,
  }}>{role}</span>;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'sage' | 'rust' }) {
  const color = accent === 'sage' ? 'var(--sage, #2E6C54)' : accent === 'rust' ? 'var(--rust, #B5483D)' : 'var(--ink)';
  return (
    <div style={{
      padding: '14px 16px', background: 'rgba(255,255,255,0.65)',
      border: '1px solid rgba(15,40,85,0.08)', borderRadius: 10,
    }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid rgba(15,40,85,0.18)', borderRadius: 999,
  fontSize: 12, color: 'var(--ink)', background: '#fff',
  fontFamily: 'inherit', outline: 'none',
};

function Th({ children, align, width }: { children: React.ReactNode; align?: 'left' | 'right'; width?: string }) {
  return (
    <th style={{
      textAlign: align || 'left', width,
      padding: '12px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700,
    }}>{children}</th>
  );
}
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '11px 14px', color: 'var(--ink)', verticalAlign: 'middle',
      fontFamily: mono ? 'inherit' : undefined,
      fontVariantNumeric: mono ? 'tabular-nums' : undefined,
    }}>{children}</td>
  );
}
