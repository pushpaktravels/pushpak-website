// ============================================================
// /portal/audit — owner-only audit-log viewer.
// ============================================================
// Layout:
//   ▸ Stats strip  — events today / failed logins / PII reveals /
//                    most-active user (last 24h)
//   ▸ Suspicious banner (when present) — login-brute / PII bursts /
//                    off-hours activity
//   ▸ Date-preset chips + manual filters
//   ▸ Quick action-count chips
//   ▸ Table with human-readable detail + Excel export
//   ▸ Load more (paginated via ts cursor)
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { ExportButton } from '../../components/ExportButton';

type AuditRow = {
  id: string; ts: string;
  userId: string | null; execId: string | null;
  action: string; target: string | null;
  detail: string | null; ip: string | null; userAgent: string | null;
};
type Suspicious = { kind: string; title: string; body: string; severity: 'rust' | 'amber' };
type Stats = {
  today: number; last24: number; week: number;
  failsToday: number; revealsToday: number;
  mostActive: { who: string; n: number } | null;
};

type Preset = 'today' | '24h' | '7d' | 'month' | 'all';

export default function AuditPage() {
  return (
    <AppShell title="Audit Log" crumb="Admin · Audit">
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [suspicious, setSuspicious] = useState<Suspicious[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissedSuspicious, setDismissedSuspicious] = useState<Set<string>>(new Set());

  // Filters
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [preset, setPreset] = useState<Preset>('24h');

  function applyPreset(p: Preset) {
    setPreset(p);
    const now = new Date();
    if (p === 'today') {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      setSince(d.toISOString().slice(0, 16));
      setUntil('');
    } else if (p === '24h') {
      const d = new Date(Date.now() - 24 * 3600 * 1000);
      setSince(d.toISOString().slice(0, 16));
      setUntil('');
    } else if (p === '7d') {
      const d = new Date(Date.now() - 7 * 86400 * 1000);
      setSince(d.toISOString().slice(0, 16));
      setUntil('');
    } else if (p === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      setSince(d.toISOString().slice(0, 16));
      setUntil('');
    } else {
      setSince(''); setUntil('');
    }
  }

  function buildQuery(extra: Record<string, string> = {}) {
    const q = new URLSearchParams();
    if (user)   q.set('user',   user);
    if (action) q.set('action', action);
    if (target) q.set('target', target);
    if (since)  q.set('since',  since);
    if (until)  q.set('until',  until);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q.toString();
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/audit?${buildQuery()}`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      setRows(r.rows || []);
      setActions(r.knownActions || []);
      setStats(r.stats || null);
      setSuspicious(r.suspicious || []);
      setNextCursor(r.nextCursor || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/audit?${buildQuery({ before: nextCursor })}`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      setRows(prev => [...prev, ...(r.rows || [])]);
      setNextCursor(r.nextCursor || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  // On mount, default to "Last 24h"
  useEffect(() => { applyPreset('24h'); /* eslint-disable-next-line */ }, []);
  // Reload whenever any filter changes
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user, action, target, since, until]);

  function reset() {
    setUser(''); setAction(''); setTarget('');
    applyPreset('24h');
  }

  const totalsByAction = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.action] = (m[r.action] || 0) + 1;
    return m;
  }, [rows]);

  const visibleSuspicious = suspicious.filter(s => !dismissedSuspicious.has(s.title));

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Audit Log</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.5, maxWidth: 760 }}>
          Every privileged mutation is logged here — who, when, from which IP, what changed. Filter by user / action / target / date.
        </p>
      </div>

      {/* Stats strip */}
      {stats && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12, marginBottom: 18,
        }}>
          <StatCard label="Events today"     value={stats.today.toString()}   sub={`${stats.last24} in last 24h`} />
          <StatCard label="Events this week" value={stats.week.toString()}    sub="rolling 7 days" />
          <StatCard label="Failed logins today" value={stats.failsToday.toString()} accent={stats.failsToday > 0 ? 'rust' : undefined} sub={stats.failsToday > 0 ? 'Review for brute-force' : 'All clear'} />
          <StatCard label="PII reveals today"   value={stats.revealsToday.toString()} accent={stats.revealsToday > 10 ? 'amber' : undefined} sub="phone / email / address fetches" />
          <StatCard
            label="Most active (24h)"
            value={stats.mostActive?.who || '—'}
            sub={stats.mostActive ? `${stats.mostActive.n} action${stats.mostActive.n === 1 ? '' : 's'}` : 'no activity'}
          />
        </div>
      )}

      {/* Suspicious-activity banner */}
      {visibleSuspicious.map((s, i) => (
        <div key={i} style={{
          padding: '14px 18px', marginBottom: 12, borderRadius: 12,
          background: s.severity === 'rust' ? 'rgba(178,79,55,0.10)' : 'rgba(217,165,69,0.12)',
          border: s.severity === 'rust' ? '1px solid rgba(178,79,55,0.32)' : '1px solid rgba(217,165,69,0.35)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 999,
            background: s.severity === 'rust' ? 'var(--rust, #B5483D)' : 'var(--amber, #B58430)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 16, flexShrink: 0,
          }}>!</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink, #0F2855)' }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{s.body}</div>
          </div>
          <button
            onClick={() => setDismissedSuspicious(prev => new Set(prev).add(s.title))}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--ink-soft)', fontSize: 11, fontWeight: 700,
              letterSpacing: '.18em', textTransform: 'uppercase', fontFamily: 'inherit',
            }}>Dismiss</button>
        </div>
      ))}

      {/* Date presets */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {([
          { key: 'today', label: 'Today'      },
          { key: '24h',   label: 'Last 24h'   },
          { key: '7d',    label: 'Last 7d'    },
          { key: 'month', label: 'This month' },
          { key: 'all',   label: 'All time'   },
        ] as Array<{ key: Preset; label: string }>).map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)} style={{
            padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
            background: preset === p.key ? 'var(--navy-deep, #0F2855)' : 'transparent',
            color: preset === p.key ? '#fff' : 'var(--ink)',
            border: preset === p.key ? '1px solid var(--navy-deep, #0F2855)' : '1px solid rgba(15,40,85,0.22)',
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
            fontFamily: 'inherit',
          }}>{p.label}</button>
        ))}
        <button onClick={reset} style={{
          marginLeft: 'auto',
          padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
          background: 'transparent', color: 'var(--ink-soft)',
          border: '1px solid rgba(15,40,85,0.22)',
          fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
          fontFamily: 'inherit',
        }}>Reset filters</button>
      </div>

      {/* Manual filters */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10, marginBottom: 14,
      }}>
        <input type="search" placeholder="User (exec ID)…" value={user} onChange={e => setUser(e.target.value)} style={inputStyle} />
        <select value={action} onChange={e => setAction(e.target.value)} style={inputStyle}>
          <option value="">All actions</option>
          {actions.map(a => <option key={a} value={a}>{prettyAction(a)}</option>)}
        </select>
        <input type="search" placeholder="Target (party / id)…" value={target} onChange={e => setTarget(e.target.value)} style={inputStyle} />
        <input type="datetime-local" value={since} onChange={e => { setSince(e.target.value); setPreset('all'); }} style={inputStyle} title="Since" />
        <input type="datetime-local" value={until} onChange={e => { setUntil(e.target.value); setPreset('all'); }} style={inputStyle} title="Until" />
      </div>

      {error && <div style={{ padding: 12, marginBottom: 14, color: 'var(--rust)' }}>Failed: {error}</div>}

      {/* Action chips */}
      {Object.keys(totalsByAction).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700 }}>Quick filter</span>
          {Object.entries(totalsByAction)
            .sort((a, b) => b[1] - a[1]).slice(0, 10)
            .map(([a, n]) => (
              <button key={a} onClick={() => setAction(action === a ? '' : a)} style={{
                ...chipStyle,
                background: action === a ? 'var(--ink, #0F2855)' : 'rgba(15,40,85,0.06)',
                color: action === a ? '#fff' : 'var(--ink-soft)',
              }}>
                <b style={{ color: action === a ? '#fff' : 'var(--ink)' }}>{prettyAction(a)}</b> · {n}
              </button>
            ))
          }
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}${nextCursor ? '+' : ''}`}
            </span>
            <ExportButton
              fileName="audit-log"
              rows={rows}
              columns={[
                { header: 'When',   get: r => new Date(r.ts).toISOString() },
                { header: 'User',   get: r => r.execId || r.userId || 'SYSTEM' },
                { header: 'Action', get: r => r.action },
                { header: 'Target', get: r => r.target || '' },
                { header: 'IP',     get: r => r.ip || '' },
                { header: 'Detail', get: r => r.detail || '' },
                { header: 'UA',     get: r => r.userAgent || '' },
              ]}
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{
        background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(15,40,85,0.10)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: 'rgba(15,40,85,0.04)', borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
              <Th>When</Th>
              <Th>User</Th>
              <Th>Action</Th>
              <Th>What happened</Th>
              <Th>IP</Th>
              <Th align="right" width="60">Detail</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                No matching entries.
              </td></tr>
            )}
            {rows.map(r => {
              const isOpen = expanded === r.id;
              const story = describeEvent(r);
              return (
                <>
                  <tr key={r.id}
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    style={{ borderBottom: '1px solid rgba(15,40,85,0.04)', cursor: 'pointer' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(15,40,85,0.04)')}
                    onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                  >
                    <Td>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{new Date(r.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{new Date(r.ts).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div>
                    </Td>
                    <Td><strong>{r.execId || r.userId || 'SYSTEM'}</strong></Td>
                    <Td><ActionPill action={r.action} /></Td>
                    <Td><span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{story}</span></Td>
                    <Td><span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.ip || '—'}</span></Td>
                    <Td align="right">
                      <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr key={`${r.id}-d`} style={{ background: 'rgba(15,40,85,0.03)' }}>
                      <td colSpan={6} style={{ padding: '14px 18px', fontSize: 12 }}>
                        <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
                          <b>Action key:</b> <code style={{ fontFamily: 'monospace' }}>{r.action}</code>
                          {r.target && <> · <b>target:</b> <code style={{ fontFamily: 'monospace' }}>{r.target}</code></>}
                        </div>
                        <pre style={{
                          margin: 0, fontFamily: 'monospace', fontSize: 11.5,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          color: 'var(--ink-soft)',
                          background: '#fff', padding: 12, borderRadius: 6, border: '1px solid rgba(15,40,85,0.08)',
                        }}>
                          {prettyDetail(r.detail)}
                        </pre>
                        {r.userAgent && (
                          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-soft)' }}>
                            <b>User agent:</b> {r.userAgent}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {nextCursor && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
          <button onClick={loadMore} disabled={loadingMore} style={{
            padding: '12px 24px', borderRadius: 8, cursor: loadingMore ? 'wait' : 'pointer',
            background: 'transparent', color: 'var(--ink)',
            border: '1px solid rgba(15,40,85,0.22)',
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase',
            fontFamily: 'inherit',
          }}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'rust' | 'amber' }) {
  const color = accent === 'rust' ? 'var(--rust, #B5483D)'
              : accent === 'amber' ? 'var(--amber, #B58430)'
              : 'var(--ink)';
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

// ─── Human-readable detail ────────────────────────────────────
function prettyAction(a: string): string {
  // Replace _ with space, title-case each chunk; keep common labels.
  return a
    .replace(/^UPLOAD_COMMIT_/, 'Refresh · ')
    .replace(/^UPLOAD_PREVIEW_/, 'Refresh preview · ')
    .replace(/^UPLOAD_/, 'Refresh · ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_, b, c) => b + c.toUpperCase());
}

// Story-style description per action — what a human would say
// out loud when reading the log entry aloud.
function describeEvent(r: AuditRow): string {
  const who = r.execId || r.userId || 'Someone';
  const t = r.target ? ` on ${r.target}` : '';
  let d: any = null;
  try { if (r.detail) d = JSON.parse(r.detail); } catch {}
  switch (r.action) {
    case 'LOGIN_OK':            return `${who} signed in`;
    case 'LOGIN_FAIL':          return `${who} tried to sign in — ${d?.reason || 'failed'}`;
    case 'LOGOUT':              return `${who} signed out`;
    case 'PII_REVEAL':          return `${who} revealed ${d?.field || 'a contact field'}${t}`;
    case 'WA_SEND':             return `${who} sent a WhatsApp ${d?.template ? `(${d.template.replace(/^WA_TPL_/,'').toLowerCase()})` : ''}${t}`;
    case 'CALL_LOG':            return `${who} logged a call${t}`;
    case 'PROMISE_ADD':         return `${who} added a promise${t}${d?.expectedBy ? ` due ${d.expectedBy}` : ''}`;
    case 'PROMISE_KEPT':        return `${who} marked a promise Kept${t}`;
    case 'PROMISE_BROKEN':      return `${who} marked a promise Broken${t}`;
    case 'HOLD_FLAG':           return `${who} flagged a hold candidate${t}`;
    case 'HOLD_APPROVE':        return `${who} approved a hold${t}`;
    case 'HOLD_RELEASE':        return `${who} released a hold${t}`;
    case 'ACCOUNT_UPDATE':      return describeAccountUpdate(who, t, d);
    case 'LEGAL_UPDATE':        return `${who} updated a legal case${t}`;
    case 'LEGAL_BULK_CONVERT':  return `${who} bulk-created ${d?.created ?? '?'} legal cases for family "${r.target}"`;
    case 'PLAN_UPDATE':         return `${who} updated a doubtful payment plan${t}`;
    case 'CONTACT_UPDATE':      return `${who} updated contact details${t}`;
    case 'BULK_ASSIGN':         return `${who} bulk-assigned ${d?.cm ? `CM=${d.cm}` : ''}${d?.exec ? ` exec=${d.exec}` : ''} on ${r.target}`;
    case 'USERS_UPDATE':        return `${who} updated users${t}`;
    case 'USER_CREATE':         return `${who} created a user${t}`;
    case 'SETTINGS_UPDATE':     return `${who} updated settings (${d?.updated ?? '?'} keys)`;
    case 'PASSWORD_RESET_BULK': return `${who} bulk-reset ${d?.count ?? '?'} user passwords`;
    case 'UPLOAD_PREVIEW_AGEWISE':    return `${who} previewed an Agewise upload (${d?.rowCount || d?.rows || '?'} rows)`;
    case 'UPLOAD_PREVIEW_FAMILYWISE': return `${who} previewed a Familywise upload`;
    case 'UPLOAD_PREVIEW_CLIENTWISE': return `${who} previewed a Clientwise upload`;
    case 'UPLOAD_PREVIEW_CUSTOMERMASTER': return `${who} previewed a Customer Master upload`;
    case 'UPLOAD_COMMIT_AGEWISE':     return `${who} applied an Agewise refresh (${describeAgewiseSummary(d)})`;
    case 'UPLOAD_COMMIT_FAMILYWISE':  return `${who} applied a Familywise refresh${describeMetaSummary(d)}`;
    case 'UPLOAD_COMMIT_CLIENTWISE':  return `${who} applied a Clientwise refresh${describeMetaSummary(d)}`;
    case 'UPLOAD_COMMIT_CUSTOMERMASTER': return `${who} applied a Customer Master refresh`;
    case 'UPLOAD_PROCESS_ALL':        return `${who} ran the combined refresh`;
    default:                    return `${who}${t}`;
  }
}

function describeAccountUpdate(who: string, t: string, d: any): string {
  if (!d) return `${who} updated an account${t}`;
  const parts: string[] = [];
  if (d.tier)         parts.push(`tier → ${d.tier}`);
  if (d.alert)        parts.push(`alert → ${d.alert}`);
  if (d.status)       parts.push(`status → ${d.status}`);
  if (d.stage)        parts.push(`stage → ${d.stage}`);
  if (d.creditLimit != null) parts.push(`credit limit → ₹${Number(d.creditLimit).toLocaleString('en-IN')}`);
  if (d.creditPeriod) parts.push(`credit period → ${d.creditPeriod}`);
  if (d.nextFu)       parts.push(`next follow-up → ${d.nextFu}`);
  if (d.family)       parts.push(`family → ${d.family}`);
  if (d.exec)         parts.push(`exec → ${d.exec}`);
  if (parts.length === 0) return `${who} updated an account${t}`;
  return `${who} updated ${parts.join(' · ')}${t}`;
}

function describeAgewiseSummary(d: any): string {
  if (!d) return '';
  const bits: string[] = [];
  if (d.createCount)     bits.push(`${d.createCount} created`);
  if (d.updateCount)     bits.push(`${d.updateCount} updated`);
  if (d.collectionCount) bits.push(`${d.collectionCount} collections`);
  if (d.holdCount)       bits.push(`${d.holdCount} new holds`);
  return bits.join(', ') || 'no changes';
}
function describeMetaSummary(d: any): string {
  if (!d) return '';
  const bits: string[] = [];
  if (d.createCount) bits.push(`${d.createCount} created`);
  if (d.updateCount) bits.push(`${d.updateCount} reassigned`);
  return bits.length ? ` · ${bits.join(', ')}` : '';
}

function prettyDetail(detail: string | null): string {
  if (!detail) return '(no detail)';
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

function ActionPill({ action }: { action: string }) {
  const tone = /FAIL/.test(action) ? 'rust'
            : /REVEAL|DELETE|RESET/.test(action) ? 'amber'
            : /COMMIT|CREATE|APPROVE|KEPT/.test(action) ? 'sage' : 'navy';
  const palette: Record<string, { bg: string; fg: string }> = {
    rust:  { bg: 'rgba(178,79,55,.14)',  fg: 'var(--rust)' },
    amber: { bg: 'rgba(217,165,69,.16)', fg: 'var(--amber, #B58430)' },
    sage:  { bg: 'rgba(46,108,84,.12)',  fg: 'var(--sage, #2E6C54)' },
    navy:  { bg: 'rgba(15,40,85,.08)',   fg: 'var(--navy-deep, #0F2855)' },
  };
  const p = palette[tone];
  return <span style={{
    background: p.bg, color: p.fg,
    fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
    padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap',
  }}>{prettyAction(action)}</span>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '1px solid rgba(15,40,85,0.18)', borderRadius: 8,
  fontSize: 13, color: 'var(--ink)', background: '#fff',
  fontFamily: 'inherit', outline: 'none',
};
const chipStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
  background: 'rgba(15,40,85,0.06)', border: '1px solid rgba(15,40,85,0.10)',
  fontSize: 11.5, color: 'var(--ink-soft)', fontFamily: 'inherit',
};

function Th({ children, align, width }: { children: React.ReactNode; align?: 'left' | 'right'; width?: string }) {
  return (
    <th style={{
      textAlign: align || 'left', width,
      padding: '12px 18px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700,
    }}>{children}</th>
  );
}
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '12px 18px', color: 'var(--ink)', verticalAlign: 'top',
    }}>{children}</td>
  );
}
