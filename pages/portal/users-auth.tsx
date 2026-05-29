// ============================================================
// /portal/users-auth — owner-only roster + permissions editor.
// ============================================================
// Table view (no per-row dropdowns). Each row shows name, exec
// ID, role pill, scoreboard toggle, visible-views count, and
// EDIT / DEACTIVATE actions. Top-right ADD USER button opens
// the same modal in create mode.
//
// The Edit modal is full-featured: name, role, password reset,
// scoreboard, and a 15-view permissions grid where each view has
// "Visible" + "View-only" checkboxes.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtRelative, fmtDateTime } from '../../lib/fmt';
import { ROLES, ROLE_SLUGS, roleLabel, type RoleSlug } from '../../lib/roles';
import { VIEWS, canAccessView, canEditView } from '../../lib/views';

type Role = RoleSlug;

type User = {
  id: string; execId: string; name: string;
  role: Role; badge: string | null;
  team: string[];
  active: boolean;
  scoreboard: boolean;
  viewPerms: string[] | null;
  viewReadOnly: string[] | null;
  totpEnrolledAt: string | null;
  mfaRequired: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
};

function isLocked(u: User): boolean {
  return !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
}

// View catalog now lives in lib/views.ts — the single source of truth
// shared with the server-side access gate (canAccessView / requireView)
// so the UI grid and the API can never disagree. Brand-new roles like
// visa / marketing / domestic-* have NO default views — the owner grants
// them via viewPerms.

// Colour palette for the role chip in the users table. Roles not
// listed here fall back to a neutral slate.
const ROLE_META: Record<string, { bg: string; fg: string }> = {
  owner:                  { bg: 'rgba(217,119,87,.16)',  fg: '#B5483D' },
  admin:                  { bg: 'rgba(217,165,69,.18)',  fg: '#7F6000' },
  'cm-accounts':          { bg: 'rgba(13,71,161,.14)',   fg: '#0D47A1' },
  accounts:               { bg: 'rgba(46,125,92,.16)',   fg: '#274E13' },
  'domestic-reservations': { bg: 'rgba(72,118,184,.14)', fg: '#1F3D7A' },
  'domestic-package':     { bg: 'rgba(105,168,219,.14)', fg: '#1D4F7E' },
  'international-packages': { bg: 'rgba(178,79,55,.12)', fg: '#7F2A1F' },
  visa:                   { bg: 'rgba(146,98,160,.14)',  fg: '#4A2E61' },
  insights:               { bg: 'rgba(100,116,139,.18)', fg: '#475569' },
  marketing:              { bg: 'rgba(217,72,118,.12)',  fg: '#7F2447' },
  hr:                     { bg: 'rgba(46,108,84,.14)',   fg: '#214F3D' },
  'support-staff':        { bg: 'rgba(120,113,108,.16)', fg: '#57534E' },
};
const ROLE_NEUTRAL = { bg: 'rgba(100,116,139,.14)', fg: '#475569' };

function visibleCount(u: User): number {
  if (u.viewPerms && u.viewPerms.length > 0) return u.viewPerms.length;
  return VIEWS.filter(v => v.roles.includes(u.role)).length;
}

export default function UsersAuthPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<User | 'new' | null>(null);
  const [tab, setTab] = useState<'roster' | 'matrix'>('roster');
  const confirm = useConfirm();

  function load() {
    fetch('/api/users')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setUsers(r.data.users || []);
      })
      .catch(e => setError(e.message));
  }
  useEffect(load, []);

  // Fire-and-reload a single-field PATCH for imperative security actions.
  async function patchUser(id: string, patch: Record<string, any>) {
    try {
      const r = await fetch('/api/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id, ...patch }] }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function unlockUser(u: User) {
    const ok = await confirm({
      title: `Unlock ${u.name}?`,
      body: `Clears the failed-attempt counter and removes the lockout so they can sign in again.`,
      confirmLabel: 'Unlock',
    });
    if (ok) patchUser(u.id, { unlock: true });
  }
  async function resetMfa(u: User) {
    const ok = await confirm({
      title: `Reset 2FA for ${u.name}?`,
      body: `Wipes their authenticator enrollment. They'll set up 2FA again on next sign-in${u.mfaRequired ? ' (2FA is required for this account)' : ''}.`,
      confirmLabel: 'Reset 2FA',
      destructive: true,
    });
    if (ok) patchUser(u.id, { resetMfa: true });
  }

  async function deactivate(u: User) {
    const ok = await confirm({
      title: `Deactivate ${u.name}?`,
      body: `They won't be able to sign in until reactivated.`,
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    try {
      const r = await fetch('/api/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id: u.id, active: false }] }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      load();
    } catch (e: any) { setError(e.message); }
  }
  async function reactivate(u: User) {
    try {
      const r = await fetch('/api/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id: u.id, active: true }] }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      load();
    } catch (e: any) { setError(e.message); }
  }
  async function toggleScoreboard(u: User, value: boolean) {
    try {
      const r = await fetch('/api/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id: u.id, scoreboard: value }] }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  if (error && !users) return <AppShell title="Users & Authorities" crumb="Roster + Permissions"><div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div></AppShell>;
  if (!users) return <AppShell title="Users & Authorities" crumb="Roster + Permissions"><div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div></AppShell>;

  return (
    <AppShell title="Users & Authorities" crumb="Roster + Permissions">
      {/* Page header with title + ADD USER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16 }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Users & Authorities</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            Control who can access the portal, what role they hold, and whether they appear on the scoreboard.
            Password changes here override the defaults in the code.
          </p>
        </div>
        <button onClick={() => setEditTarget('new')} style={{
          background: 'var(--navy-deep)', color: '#fff', border: 'none',
          borderRadius: 10, padding: '11px 20px',
          fontSize: 12, fontWeight: 700, letterSpacing: '.16em',
          cursor: 'pointer', whiteSpace: 'nowrap',
          boxShadow: '0 4px 14px rgba(15,40,85,.18)',
        }}>+ ADD USER</button>
      </div>

      {error && <div style={{ padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 }}>Failed: {error}</div>}

      {/* Tab switcher: roster vs. read-only access matrix */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <TabBtn active={tab === 'roster'} onClick={() => setTab('roster')}>Roster</TabBtn>
        <TabBtn active={tab === 'matrix'} onClick={() => setTab('matrix')}>Access matrix</TabBtn>
      </div>

      {tab === 'roster' && (
      <div style={{
        background: '#fff', border: '1px solid var(--line, #e7eaf0)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
              <Th>Name</Th>
              <Th>Executive ID</Th>
              <Th>Role</Th>
              <Th align="center">Security</Th>
              <Th align="center">Scoreboard</Th>
              <Th align="center">Visible Views</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const meta = ROLE_META[u.role] || ROLE_NEUTRAL;
              const locked = isLocked(u);
              return (
                <tr key={u.id} style={{
                  borderBottom: '1px solid var(--line, #e7eaf0)',
                  opacity: u.active ? 1 : 0.55,
                }}>
                  <Td>
                    <strong style={{ color: 'var(--navy-deep)', fontSize: 14 }}>{u.name}</strong>
                    <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 2 }}>
                      {u.lastLoginAt ? `Last in ${fmtRelative(u.lastLoginAt)}` : 'Never signed in'}
                    </div>
                  </Td>
                  <Td><span style={{ fontFamily: "inherit", fontSize: 12, color: 'var(--t-2)' }}>{u.execId}</span></Td>
                  <Td>
                    <span style={{
                      background: meta.bg, color: meta.fg,
                      padding: '4px 12px', borderRadius: 5,
                      fontSize: 10.5, fontWeight: 700, letterSpacing: '.16em',
                      textTransform: 'uppercase',
                    }}>{roleLabel(u.role)}</span>
                  </Td>
                  <Td align="center">
                    <div style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {locked && <SecChip tone="rust">Locked</SecChip>}
                      {u.totpEnrolledAt ? <SecChip tone="sage">2FA</SecChip> : (u.mfaRequired && <SecChip tone="gold">2FA req</SecChip>)}
                      {u.mustChangePassword && <SecChip tone="gold">Pwd reset</SecChip>}
                      {!locked && !u.totpEnrolledAt && !u.mfaRequired && !u.mustChangePassword && <span style={{ color: 'var(--t-3)', fontSize: 12 }}>—</span>}
                    </div>
                  </Td>
                  <Td align="center">
                    <Toggle on={u.scoreboard} onChange={v => toggleScoreboard(u, v)} disabled={!u.active} />
                  </Td>
                  <Td align="center">
                    <span style={{ fontFamily: "inherit", fontSize: 13, color: 'var(--t-2)' }}>
                      {visibleCount(u)} / {VIEWS.length}
                    </span>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 8 }}>
                      {locked && <RowBtn onClick={() => unlockUser(u)}>Unlock</RowBtn>}
                      <RowBtn onClick={() => setEditTarget(u)}>Edit</RowBtn>
                      {u.active
                        ? <RowBtn onClick={() => deactivate(u)}>Deactivate</RowBtn>
                        : <RowBtn onClick={() => reactivate(u)}>Reactivate</RowBtn>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {tab === 'matrix' && <AccessMatrix users={users} />}

      {editTarget && (
        <UserEditModal
          mode={editTarget === 'new' ? 'create' : 'edit'}
          user={editTarget === 'new' ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
          onUnlock={unlockUser}
          onResetMfa={resetMfa}
        />
      )}
    </AppShell>
  );
}

// ─── User edit / create modal ────────────────────────────────
function UserEditModal({
  mode, user, onClose, onSaved, onUnlock, onResetMfa,
}: {
  mode: 'edit' | 'create';
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
  onUnlock: (u: User) => void;
  onResetMfa: (u: User) => void;
}) {
  const [name, setName] = useState(user?.name || '');
  const [execId, setExecId] = useState(user?.execId || '');
  const [role, setRole] = useState<Role>(user?.role || 'accounts');
  const [password, setPassword] = useState('');
  const [scoreboard, setScoreboard] = useState(user?.scoreboard ?? false);
  const [mfaRequired, setMfaRequired] = useState(user?.mfaRequired ?? false);
  const [forceChange, setForceChange] = useState(user?.mustChangePassword ?? false);
  const [history, setHistory] = useState<{ ts: string; action: string; ip: string | null }[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Permissions: visible (in viewPerms) + readonly (in viewReadOnly).
  // For existing users, hydrate from their stored perms or fall back to role defaults.
  const initialVisible = user?.viewPerms && user.viewPerms.length > 0
    ? new Set(user.viewPerms)
    : new Set(VIEWS.filter(v => v.roles.includes(user?.role || 'accounts')).map(v => v.key));
  const initialReadonly = new Set(user?.viewReadOnly || []);

  const [visible, setVisible] = useState<Set<string>>(initialVisible);
  const [readonly, setReadonly] = useState<Set<string>>(initialReadonly);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleVisible(key: string) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Also clear readonly if no longer visible
        setReadonly(r => { const n = new Set(r); n.delete(key); return n; });
      } else next.add(key);
      return next;
    });
  }
  function toggleReadonly(key: string) {
    setReadonly(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function setAll() { setVisible(new Set(VIEWS.map(v => v.key))); }
  function setNone() { setVisible(new Set()); setReadonly(new Set()); }
  function setRoleDefault() {
    setVisible(new Set(VIEWS.filter(v => v.roles.includes(role)).map(v => v.key)));
    setReadonly(new Set());
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const viewPerms = Array.from(visible);
      const viewReadOnly = Array.from(readonly);

      if (mode === 'create') {
        const r = await fetch('/api/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, execId, role, password,
            scoreboard, viewPerms, viewReadOnly,
            mfaRequired, mustChangePassword: forceChange,
          }),
        }).then(x => x.json());
        if (!r?.ok) throw new Error(r?.error || 'Failed to create');
      } else {
        const update: any = {
          id: user!.id,
          name, role, scoreboard,
          viewPerms, viewReadOnly,
          mfaRequired,
        };
        // Only send mustChangePassword if it actually changed — a
        // password reset clears the flag server-side, so we avoid
        // re-arming it on save.
        if (forceChange !== (user!.mustChangePassword ?? false)) update.mustChangePassword = forceChange;
        if (password) update.password = password;
        const r = await fetch('/api/users', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: [update] }),
        }).then(x => x.json());
        if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      }
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }

  async function loadHistory() {
    setShowHistory(s => !s);
    if (history || !user) return;
    try {
      const r = await fetch(`/api/users/login-history?execId=${encodeURIComponent(user.execId)}`).then(x => x.json());
      if (r?.ok) setHistory(r.data.events || []);
    } catch { /* non-fatal */ }
  }

  const locked = user ? (!!user.lockedUntil && new Date(user.lockedUntil) > new Date()) : false;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,24,58,.55)', zIndex: 200 }} />
      <div role="dialog" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(640px, 94vw)', maxHeight: '90vh',
        background: '#fff', borderRadius: 14, boxShadow: '0 30px 80px rgba(8,24,58,.35)',
        zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <header style={{
          padding: '20px 24px', borderBottom: '1px solid var(--line, #e7eaf0)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--navy-deep)' }}>
            {mode === 'create' ? <>Add new user</> : <>Edit · <span style={{ fontWeight: 700 }}>{user!.name}</span> <span style={{ color: 'var(--t-3)', fontWeight: 500, fontSize: 14 }}>({user!.execId})</span></>}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, color: 'var(--t-2)', lineHeight: 1, padding: 0 }}>×</button>
        </header>

        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          <SectionLabel>Identity</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Full name">
              <input type="text" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Role">
              <select value={role} onChange={e => setRole(e.target.value as Role)} style={inputStyle}>
                {ROLES.map(r => (
                  <option key={r.slug} value={r.slug}>{r.label}</option>
                ))}
              </select>
            </Field>
          </div>
          {mode === 'create' && (
            <Field label="Executive ID">
              <input type="text" value={execId} onChange={e => setExecId(e.target.value.toUpperCase())} placeholder="e.g. RAUNAK01" style={{ ...inputStyle, fontFamily: "inherit" }} />
            </Field>
          )}
          <Field label={mode === 'create' ? 'Password' : <>Password <span style={{ color: 'var(--t-3)', fontWeight: 500 }}>(leave blank to keep unchanged)</span></>}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'create' ? 'Set initial password' : 'New password'}
              style={inputStyle} />
          </Field>

          <hr style={{ border: 'none', borderTop: '1px solid var(--line, #e7eaf0)', margin: '22px 0 18px' }} />

          <SectionLabel>Flags</SectionLabel>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 14px', background: 'var(--bg-2, #f6f8fb)', borderRadius: 8,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-deep)' }}>Scoreboard</div>
              <div style={{ fontSize: 11, color: 'var(--t-3)' }}>Appears on the leaderboard</div>
            </div>
            <Toggle on={scoreboard} onChange={setScoreboard} />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--line, #e7eaf0)', margin: '22px 0 18px' }} />

          {/* Account security */}
          <SectionLabel>Account security</SectionLabel>

          {mode === 'edit' && user && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
              padding: '12px 14px', background: 'var(--bg-2, #f6f8fb)', borderRadius: 8,
              fontSize: 12, color: 'var(--t-2)', marginBottom: 12,
            }}>
              <div><span style={{ color: 'var(--t-3)' }}>Last sign-in</span><br />
                <strong style={{ color: 'var(--navy-deep)' }}>{user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : 'Never'}</strong>
                {user.lastLoginIp && <span style={{ color: 'var(--t-3)' }}> · {user.lastLoginIp}</span>}
              </div>
              <div><span style={{ color: 'var(--t-3)' }}>Password changed</span><br />
                <strong style={{ color: 'var(--navy-deep)' }}>{user.passwordChangedAt ? fmtDateTime(user.passwordChangedAt) : '—'}</strong>
              </div>
              <div><span style={{ color: 'var(--t-3)' }}>2FA</span><br />
                <strong style={{ color: user.totpEnrolledAt ? 'var(--sage)' : 'var(--t-2)' }}>{user.totpEnrolledAt ? 'Enrolled' : 'Not set up'}</strong>
              </div>
              <div><span style={{ color: 'var(--t-3)' }}>Lockout</span><br />
                <strong style={{ color: locked ? 'var(--rust)' : 'var(--t-2)' }}>
                  {locked ? `Locked until ${fmtDateTime(user.lockedUntil)}` : `${user.failedAttempts || 0} failed attempt${(user.failedAttempts || 0) === 1 ? '' : 's'}`}
                </strong>
              </div>
            </div>
          )}

          {/* Per-user toggles (apply on Save) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--bg-2, #f6f8fb)', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-deep)' }}>Require 2FA</div>
                <div style={{ fontSize: 11, color: 'var(--t-3)' }}>Force this user to use an authenticator app to sign in</div>
              </div>
              <Toggle on={mfaRequired} onChange={setMfaRequired} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--bg-2, #f6f8fb)', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-deep)' }}>Force password change</div>
                <div style={{ fontSize: 11, color: 'var(--t-3)' }}>Make them set a new password at next sign-in</div>
              </div>
              <Toggle on={forceChange} onChange={setForceChange} />
            </div>
          </div>

          {/* Imperative actions (edit mode only) */}
          {mode === 'edit' && user && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              {locked && <PermBtn onClick={() => onUnlock(user)}>UNLOCK ACCOUNT</PermBtn>}
              {user.totpEnrolledAt && <PermBtn onClick={() => onResetMfa(user)}>RESET 2FA</PermBtn>}
              <PermBtn onClick={loadHistory}>{showHistory ? 'HIDE LOGIN HISTORY' : 'LOGIN HISTORY'}</PermBtn>
            </div>
          )}

          {showHistory && (
            <div style={{ marginTop: 8, border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, overflow: 'hidden' }}>
              {history === null && <div style={{ padding: 12, fontSize: 12, color: 'var(--t-3)' }}>Loading…</div>}
              {history && history.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--t-3)' }}>No recorded events.</div>}
              {history && history.map((h, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                  padding: '8px 12px', fontSize: 11.5,
                  borderBottom: i === history.length - 1 ? 'none' : '1px solid var(--line, #e7eaf0)',
                }}>
                  <span style={{ fontWeight: 600, color: h.action === 'LOGIN_OK' ? 'var(--sage)' : h.action === 'LOGIN_FAIL' ? 'var(--rust)' : 'var(--navy-deep)' }}>{h.action}</span>
                  <span style={{ color: 'var(--t-2)', flex: 1, textAlign: 'center' }}>{h.ip || ''}</span>
                  <span style={{ color: 'var(--t-3)' }}>{fmtDateTime(h.ts)}</span>
                </div>
              ))}
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--line, #e7eaf0)', margin: '22px 0 18px' }} />

          {/* View permissions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SectionLabel>View permissions</SectionLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <PermBtn onClick={setAll}>ALL</PermBtn>
              <PermBtn onClick={setNone}>NONE</PermBtn>
              <PermBtn onClick={setRoleDefault}>ROLE DEFAULT</PermBtn>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t-3)', marginBottom: 14, lineHeight: 1.5 }}>
            Tick <strong>Visible</strong> to show the sheet in the sidebar. Tick <strong>View-only</strong> if the user should see it but not edit anything within it.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {VIEWS.map(v => {
              const isVisible = visible.has(v.key);
              const isReadOnly = readonly.has(v.key);
              return (
                <div key={v.key} style={{
                  display: 'flex', gap: 6, alignItems: 'stretch',
                }}>
                  <button onClick={() => toggleVisible(v.key)} style={{
                    flex: 1, textAlign: 'left',
                    padding: '8px 10px', borderRadius: 6,
                    background: isVisible ? 'rgba(15,40,85,.06)' : 'var(--bg-2, #f6f8fb)',
                    border: `1px solid ${isVisible ? 'var(--navy)' : 'var(--line, #e7eaf0)'}`,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 12, color: 'var(--navy-deep)',
                  }}>
                    <input type="checkbox" checked={isVisible} readOnly tabIndex={-1}
                      style={{ accentColor: '#0F2855', width: 14, height: 14 }} />
                    <span>{v.label}</span>
                  </button>
                  <button onClick={() => isVisible && toggleReadonly(v.key)} disabled={!isVisible} style={{
                    minWidth: 96, padding: '8px 10px', borderRadius: 6,
                    background: isReadOnly ? 'rgba(15,40,85,.06)' : 'var(--bg-2, #f6f8fb)',
                    border: `1px solid ${isReadOnly ? 'var(--navy)' : 'var(--line, #e7eaf0)'}`,
                    cursor: isVisible ? 'pointer' : 'not-allowed',
                    opacity: isVisible ? 1 : 0.4,
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 11, color: 'var(--t-2)',
                  }}>
                    <input type="checkbox" checked={isReadOnly} readOnly tabIndex={-1}
                      style={{ accentColor: '#0F2855', width: 12, height: 12 }} />
                    <span>View-only</span>
                  </button>
                </div>
              );
            })}
          </div>

          {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 14 }}>{err}</div>}
        </div>

        <footer style={{
          padding: '14px 24px', borderTop: '1px solid var(--line, #e7eaf0)',
          background: 'var(--bg-2, #f6f8fb)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} disabled={saving} style={{
            background: 'transparent', color: 'var(--t-2)',
            border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
            padding: '10px 20px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>CANCEL</button>
          <button onClick={save} disabled={saving} style={{
            background: 'var(--navy-deep)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 22px',
            fontSize: 12, fontWeight: 700, letterSpacing: '.12em',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}>{saving ? 'SAVING…' : 'SAVE CHANGES'}</button>
        </footer>
      </div>
    </>
  );
}

// ─── Access matrix (read-only "who can see/edit what") ─────────
function AccessMatrix({ users }: { users: User[] }) {
  const active = users.filter(u => u.active);
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10, fontSize: 11.5, color: 'var(--t-2)' }}>
        <span><span style={{ color: 'var(--sage)', fontWeight: 800 }}>●</span> Full access</span>
        <span><span style={{ color: 'var(--gold, #c9a64b)', fontWeight: 800 }}>◐</span> View-only</span>
        <span><span style={{ color: 'var(--t-3)', fontWeight: 800 }}>·</span> No access</span>
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2, #f6f8fb)' }}>
              <th style={{
                position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg-2, #f6f8fb)',
                textAlign: 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
                textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, minWidth: 160,
              }}>User</th>
              {VIEWS.map(v => (
                <th key={v.key} style={{ padding: '8px 4px', verticalAlign: 'bottom', height: 120 }}>
                  <div style={{
                    writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                    whiteSpace: 'nowrap', fontSize: 10.5, color: 'var(--t-2)', fontWeight: 600,
                    margin: '0 auto',
                  }}>{v.label}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map(u => (
              <tr key={u.id} style={{ borderTop: '1px solid var(--line, #e7eaf0)' }}>
                <td style={{
                  position: 'sticky', left: 0, zIndex: 1, background: '#fff',
                  padding: '8px 14px', borderRight: '1px solid var(--line, #e7eaf0)',
                }}>
                  <strong style={{ color: 'var(--navy-deep)' }}>{u.name}</strong>
                  <div style={{ fontSize: 10, color: 'var(--t-3)' }}>{roleLabel(u.role)}</div>
                </td>
                {VIEWS.map(v => {
                  const see = canAccessView(u, v.key);
                  const edit = see && canEditView(u, v.key);
                  const mark = !see ? '·' : edit ? '●' : '◐';
                  const color = !see ? 'var(--t-3)' : edit ? 'var(--sage)' : 'var(--gold, #c9a64b)';
                  return (
                    <td key={v.key} style={{ textAlign: 'center', padding: '8px 4px' }}>
                      <span title={`${v.label}: ${!see ? 'no access' : edit ? 'full access' : 'view-only'}`}
                            style={{ color, fontWeight: 800 }}>{mark}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'var(--navy-deep)' : 'transparent',
      color: active ? '#fff' : 'var(--t-2)',
      border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)',
      borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700,
      letterSpacing: '.06em', cursor: 'pointer',
    }}>{children}</button>
  );
}
function SecChip({ tone, children }: { tone: 'rust' | 'sage' | 'gold'; children: React.ReactNode }) {
  const c = tone === 'rust' ? { bg: 'rgba(181,72,61,.12)', fg: '#B5483D' }
    : tone === 'sage' ? { bg: 'rgba(46,125,92,.14)', fg: '#2E7D5C' }
    : { bg: 'rgba(201,166,75,.16)', fg: '#7F6000' };
  return <span style={{ background: c.bg, color: c.fg, padding: '2px 7px', borderRadius: 4, fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{children}</span>;
}
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <th style={{ textAlign: align || 'left', padding: '12px 18px', fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <td style={{ textAlign: align || 'left', padding: '14px 18px', color: 'var(--t-1)', verticalAlign: 'middle' }}>{children}</td>;
}
function RowBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: '#fff', color: 'var(--t-2)',
      border: '1px solid var(--line-2, #d0d6e0)', borderRadius: 6,
      padding: '6px 14px', fontSize: 11, fontWeight: 700,
      letterSpacing: '.14em', textTransform: 'uppercase', cursor: 'pointer',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--navy)'; e.currentTarget.style.color = 'var(--navy)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2, #d0d6e0)'; e.currentTarget.style.color = 'var(--t-2)'; }}>
      {children}
    </button>
  );
}
function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 36, height: 20, borderRadius: 12,
        border: 'none', background: on ? 'var(--sage)' : 'var(--line-2, #d0d6e0)',
        position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left .15s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,.15)',
      }} />
    </button>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: '.26em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 12 }}>{children}</div>;
}
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}
function PermBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: '#fff', color: 'var(--t-2)',
      border: '1px solid var(--line, #e7eaf0)', borderRadius: 6,
      padding: '5px 11px', fontSize: 10, fontWeight: 700,
      letterSpacing: '.14em', textTransform: 'uppercase', cursor: 'pointer',
    }}>{children}</button>
  );
}
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '10px 12px',
  border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
  outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit',
  background: '#fff',
};
