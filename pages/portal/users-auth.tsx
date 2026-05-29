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
import { fmtRelative } from '../../lib/fmt';
import { ROLES, ROLE_SLUGS, roleLabel, type RoleSlug } from '../../lib/roles';

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
  lastLoginAt: string | null;
};

// ─── View catalog (mirrors components/Sidebar.tsx SECTIONS) ──
// Lists which roles see each view by default (when the user has no
// per-user viewPerms override set). Brand-new roles like visa /
// marketing / domestic-* have NO default views — the owner grants
// them via viewPerms.
const VIEWS: { key: string; label: string; roles: Role[] }[] = [
  { key: 'dashboard',           label: 'Dashboard',          roles: [...ROLE_SLUGS] }, // personal, every user
  { key: 'profile',             label: 'My Profile',         roles: [...ROLE_SLUGS] }, // personal, every user
  { key: 'followup-dashboard',  label: 'Followup Dashboard', roles: ['owner','admin','cm-accounts','accounts','insights'] },
  { key: 'worklist',            label: 'My Worklist',        roles: ['owner','admin','cm-accounts','accounts'] },
  { key: 'team-worklist',       label: 'Team Worklist',      roles: ['owner','admin','cm-accounts'] },
  { key: 'hold-check',          label: 'Hold Check',         roles: ['owner','admin','cm-accounts','accounts'] },
  { key: 'families',            label: 'Clients & Families', roles: ['owner','admin'] },
  { key: 'promises',            label: 'Promise Ledger',     roles: ['owner','admin','cm-accounts','accounts'] },
  { key: 'payment-plans',       label: 'Doubtful Ledger',    roles: ['owner','admin','cm-accounts','accounts'] },
  { key: 'legal',               label: 'Legal Ledger',       roles: ['owner','admin','cm-accounts','accounts','insights'] },
  { key: 'collections',         label: 'Collection List',    roles: ['owner','admin','cm-accounts','accounts','insights'] },
  { key: 'upload',              label: 'Upload & Refresh',   roles: ['owner','admin'] },
  { key: 'performance',         label: 'Performance',        roles: ['owner','admin','cm-accounts','accounts'] },
  { key: 'scoreboard',          label: 'Scoreboard',         roles: ['owner','admin','cm-accounts'] },
  { key: 'insights',            label: 'Insights',           roles: ['owner','insights'] },
  { key: 'attendance',          label: 'Attendance',         roles: ['owner','admin','hr'] },
  { key: 'employees',           label: 'Employees',          roles: ['owner','admin','hr'] },
  { key: 'users-auth',          label: 'Users & Authorities', roles: ['owner'] },
  { key: 'bulk-cm',             label: 'Bulk CM Assignment', roles: ['owner','admin'] },
  { key: 'audit',               label: 'Audit Log',          roles: ['owner'] },
  { key: 'permissions',         label: 'Permissions',        roles: ['owner'] },
  { key: 'activity',            label: 'Activity & Time',    roles: ['owner','admin'] },
  { key: 'settings',            label: 'Settings',           roles: ['owner','admin'] },
];

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

      {/* Table */}
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
              <Th align="center">Scoreboard</Th>
              <Th align="center">Visible Views</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const meta = ROLE_META[u.role] || ROLE_NEUTRAL;
              return (
                <tr key={u.id} style={{
                  borderBottom: '1px solid var(--line, #e7eaf0)',
                  opacity: u.active ? 1 : 0.55,
                }}>
                  <Td>
                    <strong style={{ color: 'var(--navy-deep)', fontSize: 14 }}>{u.name}</strong>
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
                    <Toggle on={u.scoreboard} onChange={v => toggleScoreboard(u, v)} disabled={!u.active} />
                  </Td>
                  <Td align="center">
                    <span style={{ fontFamily: "inherit", fontSize: 13, color: 'var(--t-2)' }}>
                      {visibleCount(u)} / {VIEWS.length}
                    </span>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 8 }}>
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

      {editTarget && (
        <UserEditModal
          mode={editTarget === 'new' ? 'create' : 'edit'}
          user={editTarget === 'new' ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}
    </AppShell>
  );
}

// ─── User edit / create modal ────────────────────────────────
function UserEditModal({
  mode, user, onClose, onSaved,
}: {
  mode: 'edit' | 'create';
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user?.name || '');
  const [execId, setExecId] = useState(user?.execId || '');
  const [role, setRole] = useState<Role>(user?.role || 'accounts');
  const [password, setPassword] = useState('');
  const [scoreboard, setScoreboard] = useState(user?.scoreboard ?? false);

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
          }),
        }).then(x => x.json());
        if (!r?.ok) throw new Error(r?.error || 'Failed to create');
      } else {
        const update: any = {
          id: user!.id,
          name, role, scoreboard,
          viewPerms, viewReadOnly,
        };
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

// ─── Bits ────────────────────────────────────────────────────
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
