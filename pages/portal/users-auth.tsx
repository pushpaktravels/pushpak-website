// ============================================================
// /portal/users-auth — owner-only Users & Authorities editor.
// ============================================================
// Inline-edit role, active flag, scoreboard visibility per user.
// "Edit team" opens a small modal for that user's team membership.
// Save All commits dirty rows as a single PATCH.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtRelative } from '../../lib/fmt';

type User = {
  id: string; execId: string; name: string;
  role: 'owner' | 'admin' | 'cm' | 'exec' | 'analyst';
  badge: string | null;
  team: string[];
  active: boolean;
  scoreboard: boolean;
  viewPerms: string[] | null;
  viewReadOnly: string[] | null;
  totpEnrolledAt: string | null;
  lastLoginAt: string | null;
};

type Edit = {
  role?: User['role'];
  active?: boolean;
  scoreboard?: boolean;
  team?: string[];
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [teamModalFor, setTeamModalFor] = useState<string | null>(null);

  function load() {
    fetch('/api/users')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setUsers(r.data.users || []);
        setEdits({});
      })
      .catch(e => setError(e.message));
  }
  useEffect(load, []);

  function getValue<K extends keyof Edit>(u: User, key: K): any {
    return edits[u.id]?.[key] !== undefined ? edits[u.id][key] : (u as any)[key];
  }
  function setEdit<K extends keyof Edit>(id: string, key: K, value: Edit[K]) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  async function saveAll() {
    setSaving(true); setError(null); setSavedMsg(null);
    try {
      const updates = Object.entries(edits).map(([id, e]) => ({ id, ...e }));
      const r = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      setSavedMsg(`Saved ${r.updated} user${r.updated === 1 ? '' : 's'}.`);
      setTimeout(() => setSavedMsg(null), 3000);
      load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  const dirty = Object.keys(edits).length > 0;
  const allExecNames = useMemo(() =>
    users ? Array.from(new Set(users.map(u => u.name.toUpperCase()))).sort() : []
  , [users]);

  if (error && !users) return <AppShell title="Users & Authorities" crumb="Users & Authorities"><div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div></AppShell>;
  if (!users) return <AppShell title="Users & Authorities" crumb="Users & Authorities"><div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div></AppShell>;

  const teamModalUser = teamModalFor ? users.find(u => u.id === teamModalFor) : null;

  return (
    <AppShell title="Users & Authorities" crumb="Users & Authorities">
      {/* Save bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 18px', marginBottom: 16, borderRadius: 12,
        background: dirty ? 'var(--navy-deep)' : 'var(--bg-1, #fff)',
        color: dirty ? '#fff' : 'inherit',
        border: dirty ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)',
      }}>
        <div style={{ fontSize: 12 }}>
          {dirty ? <strong>{Object.keys(edits).length} unsaved change{Object.keys(edits).length === 1 ? '' : 's'}</strong>
                 : savedMsg ? <span style={{ color: 'var(--sage)', fontWeight: 600 }}>{savedMsg}</span>
                 : `${users.length} users · ${users.filter(u => u.active).length} active`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {dirty && (
            <button onClick={() => setEdits({})} disabled={saving} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,.3)',
              color: '#fff', borderRadius: 8, padding: '8px 14px',
              fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            }}>Discard</button>
          )}
          <button onClick={saveAll} disabled={!dirty || saving} style={{
            background: dirty ? '#fff' : 'var(--navy-deep)',
            color: dirty ? 'var(--navy-deep)' : '#fff',
            border: 'none', borderRadius: 8, padding: '8px 18px',
            fontSize: 12, fontWeight: 700, cursor: (dirty && !saving) ? 'pointer' : 'not-allowed',
            opacity: (dirty && !saving) ? 1 : 0.5,
          }}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      {error && <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div>}

      <div style={{
        background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
              <Th>Name</Th>
              <Th>Exec ID</Th>
              <Th>Role</Th>
              <Th>Team</Th>
              <Th align="center">Active</Th>
              <Th align="center">Scoreboard</Th>
              <Th align="center">2FA</Th>
              <Th>Last login</Th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isDirty = !!edits[u.id];
              return (
                <tr key={u.id} style={{
                  borderBottom: '1px solid var(--line, #e7eaf0)',
                  background: isDirty ? 'rgba(217,165,69,.06)' : 'transparent',
                }}>
                  <Td><strong style={{ color: 'var(--navy-deep)' }}>{u.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--t-3)' }}>{u.badge}</div>
                  </Td>
                  <Td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{u.execId}</span></Td>
                  <Td>
                    <select value={getValue(u, 'role')} onChange={e => setEdit(u.id, 'role', e.target.value as User['role'])} style={selectStyle}>
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="cm">cm</option>
                      <option value="exec">exec</option>
                      <option value="analyst">analyst</option>
                    </select>
                  </Td>
                  <Td>
                    <button onClick={() => setTeamModalFor(u.id)} style={{
                      background: 'transparent', border: '1px solid var(--line, #e7eaf0)',
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      color: 'var(--t-2)',
                    }}>
                      {getValue(u, 'team').length === 0 ? 'No team' : `${getValue(u, 'team').length} member${getValue(u, 'team').length === 1 ? '' : 's'}`}
                    </button>
                  </Td>
                  <Td align="center"><Toggle checked={getValue(u, 'active')} onChange={v => setEdit(u.id, 'active', v)} /></Td>
                  <Td align="center"><Toggle checked={getValue(u, 'scoreboard')} onChange={v => setEdit(u.id, 'scoreboard', v)} /></Td>
                  <Td align="center"><span style={{ fontSize: 11, color: u.totpEnrolledAt ? 'var(--sage)' : 'var(--t-3)' }}>{u.totpEnrolledAt ? '✓' : '—'}</span></Td>
                  <Td><span style={{ fontSize: 11, color: 'var(--t-3)' }}>{fmtRelative(u.lastLoginAt)}</span></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Team editor modal */}
      {teamModalUser && (
        <TeamModal
          user={teamModalUser}
          currentTeam={getValue(teamModalUser, 'team')}
          allExecs={allExecNames.filter(n => n !== teamModalUser.name.toUpperCase())}
          onClose={() => setTeamModalFor(null)}
          onSave={(t) => { setEdit(teamModalUser.id, 'team', t); setTeamModalFor(null); }}
        />
      )}
    </AppShell>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) { return <th style={{ textAlign: align || 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>; }
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) { return <td style={{ textAlign: align || 'left', padding: '10px 14px', color: 'var(--t-1)', verticalAlign: 'middle' }}>{children}</td>; }

const selectStyle: React.CSSProperties = { fontSize: 12, padding: '4px 8px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 6, color: 'var(--navy-deep)', background: 'var(--bg-1, #fff)' };

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: 32, height: 18, borderRadius: 10,
      background: checked ? 'var(--sage)' : 'var(--bg-2, #e7eaf0)',
      border: 'none', position: 'relative', cursor: 'pointer', padding: 0,
      transition: 'background .12s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: '#fff', transition: 'left .12s',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

function TeamModal({
  user, currentTeam, allExecs, onClose, onSave,
}: {
  user: User;
  currentTeam: string[];
  allExecs: string[];
  onClose: () => void;
  onSave: (team: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentTeam));
  function toggle(name: string) {
    setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(11,22,41,.55)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(520px, 92vw)', maxHeight: '80vh',
        background: 'var(--bg-1, #fff)', borderRadius: 14,
        boxShadow: '0 20px 60px rgba(11,22,41,.35)', zIndex: 201,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
          <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>Team for</div>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--navy-deep)' }}>{user.name}</h3>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--t-3)' }}>
            Selected exec names this user can see in worklists and ledgers. Empty = only their own accounts.
          </p>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {allExecs.length === 0 && <div style={{ color: 'var(--t-3)', fontSize: 13 }}>No other execs available.</div>}
          {allExecs.map(name => {
            const isSel = selected.has(name);
            return (
              <label key={name} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 6, cursor: 'pointer', background: isSel ? 'rgba(83,127,107,.10)' : 'transparent',
              }}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(name)} />
                <span style={{ fontSize: 13, color: 'var(--t-1)' }}>{name}</span>
              </label>
            );
          })}
        </div>
        <footer style={{ padding: '12px 18px', borderTop: '1px solid var(--line, #e7eaf0)', display: 'flex', justifyContent: 'space-between', gap: 8, background: 'var(--bg-2, #f6f8fb)' }}>
          <span style={{ fontSize: 12, color: 'var(--t-3)', alignSelf: 'center' }}>{selected.size} selected</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => onSave(Array.from(selected).sort())} style={{ background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Apply</button>
          </div>
        </footer>
      </div>
    </>
  );
}
