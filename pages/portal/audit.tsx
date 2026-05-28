// ============================================================
// /portal/audit — owner-only audit-log viewer.
// ============================================================
// Filters: user (exec ID), action, target (party / userId), date
// range. Shows ts / user / action / target / IP / collapsible detail.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type AuditRow = {
  id: string; ts: string;
  userId: string | null; execId: string | null;
  action: string; target: string | null;
  detail: string | null; ip: string | null; userAgent: string | null;
};

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filters
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  async function load() {
    setLoading(true); setError(null);
    const q = new URLSearchParams();
    if (user)   q.set('user',   user);
    if (action) q.set('action', action);
    if (target) q.set('target', target);
    if (since)  q.set('since',  since);
    if (until)  q.set('until',  until);
    try {
      const r = await fetch(`/api/audit?${q}`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      setRows(r.rows || []);
      setActions(r.knownActions || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function reset() {
    setUser(''); setAction(''); setTarget(''); setSince(''); setUntil('');
    setTimeout(load, 0);
  }

  const totalsByAction = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.action] = (m[r.action] || 0) + 1;
    return m;
  }, [rows]);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Audit Log</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.5, maxWidth: 760 }}>
          Every privileged mutation is logged here — who, when, from which IP, what changed. Filter by user / action / target / date.
        </p>
      </div>

      {/* Filters */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10, marginBottom: 14,
      }}>
        <input type="search" placeholder="User (exec ID)…" value={user} onChange={e => setUser(e.target.value)} style={inputStyle} />
        <select value={action} onChange={e => setAction(e.target.value)} style={inputStyle}>
          <option value="">All actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="search" placeholder="Target (party / id)…" value={target} onChange={e => setTarget(e.target.value)} style={inputStyle} />
        <input type="datetime-local" value={since} onChange={e => setSince(e.target.value)} style={inputStyle} title="Since" />
        <input type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} style={inputStyle} title="Until" />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load}  style={btnPrimary} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
          <button onClick={reset} style={btnSecondary}>Reset</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, marginBottom: 14, color: 'var(--rust)' }}>Failed: {error}</div>
      )}

      {/* Action counts strip */}
      {Object.keys(totalsByAction).length > 0 && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14,
          fontSize: 11.5, color: 'var(--ink-soft)',
        }}>
          {Object.entries(totalsByAction)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([a, n]) => (
              <button key={a} onClick={() => { setAction(a); setTimeout(load, 0); }} style={chipStyle}>
                <b style={{ color: 'var(--ink)' }}>{a}</b> · {n}
              </button>
            ))
          }
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
              <Th>Target</Th>
              <Th>IP</Th>
              <Th align="right" width="60">Detail</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                {error ? 'Failed.' : 'No matching entries.'}
              </td></tr>
            )}
            {rows.map(r => {
              const isOpen = expanded === r.id;
              return (
                <>
                  <tr key={r.id}
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    style={{ borderBottom: '1px solid rgba(15,40,85,0.04)', cursor: 'pointer' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(15,40,85,0.04)')}
                    onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                  >
                    <Td>{new Date(r.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}</Td>
                    <Td><strong>{r.execId || r.userId || 'SYSTEM'}</strong></Td>
                    <Td><ActionPill action={r.action} /></Td>
                    <Td>{r.target || '—'}</Td>
                    <Td><span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.ip || '—'}</span></Td>
                    <Td align="right">
                      <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr key={`${r.id}-d`} style={{ background: 'rgba(15,40,85,0.03)' }}>
                      <td colSpan={6} style={{ padding: '14px 18px', fontSize: 12 }}>
                        <pre style={{
                          margin: 0, fontFamily: 'inherit', fontSize: 11.5,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          color: 'var(--ink-soft)',
                        }}>
                          {prettyDetail(r.detail)}
                          {r.userAgent && `\n\nUA: ${r.userAgent}`}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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
            : /COMMIT|CREATE|APPROVE/.test(action) ? 'sage' : 'navy';
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
    padding: '3px 8px', borderRadius: 4,
  }}>{action}</span>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '1px solid rgba(15,40,85,0.18)', borderRadius: 8,
  fontSize: 13, color: 'var(--ink)', background: '#fff',
  fontFamily: 'inherit', outline: 'none',
};
const btnPrimary: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
  background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff',
  border: 'none', fontSize: 11, fontWeight: 700,
  letterSpacing: '.22em', textTransform: 'uppercase', fontFamily: 'inherit',
};
const btnSecondary: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
  background: 'transparent', color: 'var(--ink)',
  border: '1px solid rgba(15,40,85,0.22)', fontSize: 11, fontWeight: 700,
  letterSpacing: '.22em', textTransform: 'uppercase', fontFamily: 'inherit',
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
      padding: '12px 18px', color: 'var(--ink)', verticalAlign: 'middle',
    }}>{children}</td>
  );
}
