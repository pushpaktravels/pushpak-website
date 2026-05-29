// ============================================================
// /portal/permissions — VANSHIKA01-only governance page.
// ============================================================
// Three tabs:
//   1. Permissions — user × module matrix with per-cell dropdowns
//      (None / View / Edit / Admin). Filter by department + search.
//   2. Departments — list + create + edit (slug, name, color, order).
//   3. Modules     — list grouped by dept + create + edit (slug,
//      name, route, icon, description).
//
// Server enforces the same lock — every mutation API requires
// execId === 'VANSHIKA01'. The page just adds a friendly upfront
// block for everyone else.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';

type Dept = { id: string; slug: string; name: string; color: string | null; icon: string | null; order: number; active: boolean; moduleCount: number };
type Module = {
  id: string; slug: string; name: string; route: string | null; description: string | null;
  icon: string | null; order: number; active: boolean;
  departmentId: string; departmentSlug: string; departmentName: string; departmentColor: string | null;
};
type Grant = {
  id: string; userId: string; moduleId: string; level: 'view'|'edit'|'admin';
  userName: string; userExecId: string; userRole: string;
  moduleSlug: string; moduleName: string;
  departmentId: string; departmentSlug: string; departmentName: string;
};
type Me = { ok: boolean; user: { execId: string; name: string; role: string } };

const LOCKED_EXEC_ID = 'VANSHIKA01';

export default function PermissionsPage() {
  return (
    <AppShell title="Permissions" crumb="Admin · Governance">
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(setMe).catch(() => setMe(null));
  }, []);

  if (!me) return <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading…</div>;
  if (me.user.execId !== LOCKED_EXEC_ID) return <LockedView execId={me.user.execId} />;

  return <PermissionsManager />;
}

function LockedView({ execId }: { execId: string }) {
  return (
    <div style={{ maxWidth: 640, margin: '60px auto', padding: 32, textAlign: 'center', background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(178,79,55,0.32)', borderRadius: 16 }}>
      <div style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 999, background: 'rgba(178,79,55,.12)', color: 'var(--rust)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <h2 style={{ fontSize: 20, color: 'var(--ink)', margin: 0 }}>Permission management is restricted</h2>
      <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 12, lineHeight: 1.6 }}>
        This page is locked to the system owner (<b>{LOCKED_EXEC_ID}</b>) and cannot be opened from <b>{execId}</b>. If you need a permission change, please raise it with the owner.
      </p>
    </div>
  );
}

// ─── Main manager ─────────────────────────────────────────────
function PermissionsManager() {
  const [tab, setTab] = useState<'grants' | 'departments' | 'modules'>('grants');
  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Permissions</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.5, maxWidth: 820 }}>
          Define departments, modules, and per-user access (None / View / Edit / Admin). Restricted to {LOCKED_EXEC_ID}. Every grant or revoke is recorded in the Audit Log.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
        {(['grants','departments','modules'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '12px 18px', background: 'transparent', border: 'none', cursor: 'pointer',
            color: tab === t ? 'var(--ink, #0F2855)' : 'var(--ink-soft)',
            fontWeight: 700, fontSize: 12, letterSpacing: '.18em', textTransform: 'uppercase',
            fontFamily: 'inherit',
            borderBottom: tab === t ? '2px solid var(--gold, #C9A472)' : '2px solid transparent',
            marginBottom: -1,
          }}>{t === 'grants' ? 'User permissions' : t}</button>
        ))}
      </div>

      {tab === 'grants'      && <GrantsMatrix />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'modules'     && <ModulesTab />}
    </div>
  );
}

// ─── Departments tab ──────────────────────────────────────────
function DepartmentsTab() {
  const [rows, setRows]   = useState<Dept[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit]   = useState<Partial<Dept> | null>(null);
  const confirm = useConfirm();

  async function load() {
    const r = await fetch('/api/permissions/departments').then(x => x.json());
    if (r?.ok) setRows(r.rows); else setError(r?.error || 'Failed to load');
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!edit) return;
    const isNew = !edit.id;
    setError(null);
    try {
      const r = await fetch('/api/permissions/departments', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      setEdit(null);
      load();
    } catch (e: any) { setError(e.message); }
  }
  async function del(d: Dept) {
    if (d.moduleCount > 0) {
      setError(`${d.name} has ${d.moduleCount} module${d.moduleCount === 1 ? '' : 's'}. Move or delete them first.`);
      return;
    }
    const ok = await confirm({ title: `Delete ${d.name}?`, body: 'Permissions on its modules will cascade-delete.', destructive: true, confirmLabel: 'Delete' });
    if (!ok) return;
    await fetch(`/api/permissions/departments?id=${d.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <ToolbarRow onAdd={() => setEdit({ name: '', slug: '', order: rows.length })} addLabel="Add department" />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div style={cardStyle}>
        {rows.length === 0 ? (
          <Empty label="No departments yet. Create one to start." />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr style={theadStyle}>
                <Th>Order</Th><Th>Slug</Th><Th>Name</Th><Th>Color</Th>
                <Th align="right">Modules</Th><Th>Active</Th><Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
                  <Td>{d.order}</Td>
                  <Td><code style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.slug}</code></Td>
                  <Td><strong>{d.name}</strong></Td>
                  <Td>{d.color ? <span style={{ display: 'inline-block', width: 18, height: 18, background: d.color, borderRadius: 4, border: '1px solid rgba(15,40,85,0.12)' }} /> : '—'}</Td>
                  <Td align="right">{d.moduleCount}</Td>
                  <Td>{d.active ? <Pill tone="sage">YES</Pill> : <Pill tone="rust">NO</Pill>}</Td>
                  <Td align="right">
                    <BtnLink onClick={() => setEdit(d)}>Edit</BtnLink>
                    <BtnLink onClick={() => del(d)} tone="rust">Delete</BtnLink>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <DeptModal value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)} />}
    </>
  );
}

function DeptModal({ value, onChange, onSave, onClose }: { value: Partial<Dept>; onChange: (v: any) => void; onSave: () => void; onClose: () => void }) {
  return (
    <ModalShell title={value.id ? 'Edit department' : 'Add department'} onClose={onClose} onSave={onSave}>
      <Field label="Slug"><input value={value.slug || ''} onChange={e => onChange({ ...value, slug: e.target.value })} placeholder="e.g. accounts, hr, sales" disabled={!!value.id} style={inputStyle} /></Field>
      <Field label="Name"><input value={value.name || ''} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="Accounts" style={inputStyle} /></Field>
      <Field label="Color (hex)"><input value={value.color || ''} onChange={e => onChange({ ...value, color: e.target.value })} placeholder="#0F2855" style={inputStyle} /></Field>
      <Field label="Order"><input type="number" value={value.order ?? 0} onChange={e => onChange({ ...value, order: Number(e.target.value) })} style={inputStyle} /></Field>
      {value.id && (
        <Field label="Active">
          <select value={value.active === false ? 'no' : 'yes'} onChange={e => onChange({ ...value, active: e.target.value === 'yes' })} style={inputStyle}>
            <option value="yes">Yes</option>
            <option value="no">No (hidden)</option>
          </select>
        </Field>
      )}
    </ModalShell>
  );
}

// ─── Modules tab ──────────────────────────────────────────────
function ModulesTab() {
  const [rows, setRows]   = useState<Module[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit]   = useState<Partial<Module> | null>(null);
  const [filterDept, setFilterDept] = useState('');
  const confirm = useConfirm();

  async function load() {
    const [a, b] = await Promise.all([
      fetch('/api/permissions/modules').then(x => x.json()),
      fetch('/api/permissions/departments').then(x => x.json()),
    ]);
    if (a?.ok) setRows(a.rows); else setError(a?.error || 'Failed');
    if (b?.ok) setDepts(b.rows);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => filterDept ? rows.filter(r => r.departmentId === filterDept) : rows, [rows, filterDept]);

  async function save() {
    if (!edit) return;
    setError(null);
    try {
      const r = await fetch('/api/permissions/modules', {
        method: edit.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed');
      setEdit(null); load();
    } catch (e: any) { setError(e.message); }
  }
  async function del(m: Module) {
    const ok = await confirm({ title: `Delete ${m.name}?`, body: 'Permissions on this module will be revoked.', destructive: true, confirmLabel: 'Delete' });
    if (!ok) return;
    await fetch(`/api/permissions/modules?id=${m.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <ToolbarRow
        onAdd={() => setEdit({ name: '', slug: '', order: rows.length, departmentId: depts[0]?.id || '' })}
        addLabel="Add module"
        addDisabled={depts.length === 0}
        right={
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ ...inputStyle, width: 240 }}>
            <option value="">All departments</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        }
      />
      {depts.length === 0 && (
        <ErrorBox>Create a department first before adding modules.</ErrorBox>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div style={cardStyle}>
        {filtered.length === 0 ? (
          <Empty label="No modules to show." />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr style={theadStyle}>
                <Th>Department</Th><Th>Slug</Th><Th>Name</Th><Th>Route</Th>
                <Th>Active</Th><Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
                  <Td><Pill tone="navy">{m.departmentName}</Pill></Td>
                  <Td><code style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.slug}</code></Td>
                  <Td><strong>{m.name}</strong>{m.description && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{m.description}</div>}</Td>
                  <Td>{m.route ? <code style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--ink-soft)' }}>{m.route}</code> : '—'}</Td>
                  <Td>{m.active ? <Pill tone="sage">YES</Pill> : <Pill tone="rust">NO</Pill>}</Td>
                  <Td align="right">
                    <BtnLink onClick={() => setEdit(m)}>Edit</BtnLink>
                    <BtnLink onClick={() => del(m)} tone="rust">Delete</BtnLink>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <ModuleModal value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)} depts={depts} />}
    </>
  );
}

function ModuleModal({ value, onChange, onSave, onClose, depts }: { value: Partial<Module>; onChange: (v: any) => void; onSave: () => void; onClose: () => void; depts: Dept[] }) {
  return (
    <ModalShell title={value.id ? 'Edit module' : 'Add module'} onClose={onClose} onSave={onSave}>
      <Field label="Department"><select value={value.departmentId || ''} onChange={e => onChange({ ...value, departmentId: e.target.value })} style={inputStyle}>
        {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select></Field>
      <Field label="Slug"><input value={value.slug || ''} onChange={e => onChange({ ...value, slug: e.target.value })} placeholder="e.g. accounts.worklist, hr.employees" disabled={!!value.id} style={inputStyle} /></Field>
      <Field label="Name"><input value={value.name || ''} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="My Worklist" style={inputStyle} /></Field>
      <Field label="Route (optional)"><input value={value.route || ''} onChange={e => onChange({ ...value, route: e.target.value })} placeholder="/portal/worklist" style={inputStyle} /></Field>
      <Field label="Description (optional)"><input value={value.description || ''} onChange={e => onChange({ ...value, description: e.target.value })} style={inputStyle} /></Field>
      <Field label="Order"><input type="number" value={value.order ?? 0} onChange={e => onChange({ ...value, order: Number(e.target.value) })} style={inputStyle} /></Field>
      {value.id && (
        <Field label="Active">
          <select value={value.active === false ? 'no' : 'yes'} onChange={e => onChange({ ...value, active: e.target.value === 'yes' })} style={inputStyle}>
            <option value="yes">Yes</option>
            <option value="no">No (hidden)</option>
          </select>
        </Field>
      )}
    </ModalShell>
  );
}

// ─── Grants matrix ─────────────────────────────────────────────
function GrantsMatrix() {
  const [grants, setGrants]   = useState<Grant[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [users, setUsers]     = useState<Array<{ id: string; name: string; execId: string; role: string }>>([]);
  const [filterDept, setFilterDept] = useState('');
  const [search, setSearch]   = useState('');
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState<string | null>(null);

  async function load() {
    const [g, m, u] = await Promise.all([
      fetch('/api/permissions/grants').then(x => x.json()),
      fetch('/api/permissions/modules').then(x => x.json()),
      fetch('/api/users').then(x => x.json()),
    ]);
    if (g?.ok) setGrants(g.rows); else setError(g?.error || 'Failed');
    if (m?.ok) setModules(m.rows);
    if (u?.ok) setUsers((u.data?.users || []).filter((x: any) => x.active));
  }
  useEffect(() => { load(); }, []);

  // index grants by (userId, moduleId)
  const grantMap = useMemo(() => {
    const map = new Map<string, Grant>();
    grants.forEach(g => map.set(`${g.userId}|${g.moduleId}`, g));
    return map;
  }, [grants]);

  const filteredModules = useMemo(() => filterDept ? modules.filter(m => m.departmentId === filterDept) : modules, [modules, filterDept]);
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => u.name.toLowerCase().includes(q) || u.execId.toLowerCase().includes(q));
  }, [users, search]);

  // Group modules by department for the column headers
  const moduleGroups = useMemo(() => {
    const groups: Array<{ dept: { id: string; name: string }; modules: Module[] }> = [];
    for (const m of filteredModules) {
      let g = groups.find(x => x.dept.id === m.departmentId);
      if (!g) { g = { dept: { id: m.departmentId, name: m.departmentName }, modules: [] }; groups.push(g); }
      g.modules.push(m);
    }
    return groups;
  }, [filteredModules]);

  async function grant(userId: string, moduleId: string, level: '' | 'view' | 'edit' | 'admin') {
    const key = `${userId}|${moduleId}`;
    setSaving(key); setError(null);
    try {
      if (level === '') {
        await fetch(`/api/permissions/grants?userId=${userId}&moduleId=${moduleId}`, { method: 'DELETE' });
      } else {
        await fetch('/api/permissions/grants', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant: { userId, moduleId, level } }),
        });
      }
      // Optimistic refresh of the local map
      const newRows = await fetch('/api/permissions/grants').then(x => x.json());
      if (newRows?.ok) setGrants(newRows.rows);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(null); }
  }

  if (modules.length === 0) {
    return <Empty label="Create at least one department and one module before granting permissions." padded />;
  }

  return (
    <>
      <ToolbarRow
        left={<input type="search" placeholder="Search user…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: 240 }} />}
        right={
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ ...inputStyle, width: 240 }}>
            <option value="">All departments</option>
            {Array.from(new Set(modules.map(m => m.departmentId))).map(deptId => {
              const sample = modules.find(m => m.departmentId === deptId)!;
              return <option key={deptId} value={deptId}>{sample.departmentName}</option>;
            })}
          </select>
        }
      />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div style={{ ...cardStyle, padding: 0, overflow: 'auto' }}>
        <table style={{ ...tableStyle, fontSize: 12.5, minWidth: 600 + filteredModules.length * 130 }}>
          <thead>
            <tr style={theadStyle}>
              <Th>{' '}</Th>
              {moduleGroups.map(g => (
                <th key={g.dept.id} colSpan={g.modules.length} style={{
                  textAlign: 'center', padding: '8px 10px', fontSize: 10,
                  letterSpacing: '.22em', textTransform: 'uppercase',
                  color: 'var(--ink, #0F2855)', fontWeight: 700,
                  borderBottom: '2px solid var(--gold, #C9A472)',
                }}>{g.dept.name}</th>
              ))}
            </tr>
            <tr style={theadStyle}>
              <Th>User</Th>
              {filteredModules.map(m => (
                <th key={m.id} style={{
                  textAlign: 'center', padding: '10px 8px', fontSize: 10,
                  letterSpacing: '.12em', color: 'var(--ink-soft)', fontWeight: 700,
                  borderRight: '1px solid rgba(15,40,85,0.05)',
                  minWidth: 120, maxWidth: 140,
                }}>{m.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
                <Td>
                  <strong>{u.name}</strong>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{u.execId} · {u.role}</div>
                </Td>
                {filteredModules.map(m => {
                  const g = grantMap.get(`${u.id}|${m.id}`);
                  const key = `${u.id}|${m.id}`;
                  return (
                    <td key={m.id} style={{ padding: '8px 6px', textAlign: 'center', borderRight: '1px solid rgba(15,40,85,0.04)' }}>
                      <select
                        value={g?.level || ''}
                        onChange={e => grant(u.id, m.id, e.target.value as any)}
                        disabled={saving === key}
                        style={{
                          width: '100%', padding: '5px 6px', borderRadius: 6,
                          fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                          fontFamily: 'inherit', cursor: 'pointer',
                          background: levelColor(g?.level).bg,
                          color:      levelColor(g?.level).fg,
                          border:     `1px solid ${levelColor(g?.level).border}`,
                        }}>
                        <option value="">None</option>
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function levelColor(level?: string) {
  switch (level) {
    case 'admin': return { bg: 'rgba(178,79,55,.12)',  fg: 'var(--rust, #B5483D)', border: 'rgba(178,79,55,.40)' };
    case 'edit':  return { bg: 'rgba(217,165,69,.16)', fg: 'var(--amber, #B58430)', border: 'rgba(217,165,69,.40)' };
    case 'view':  return { bg: 'rgba(46,108,84,.10)',  fg: 'var(--sage, #2E6C54)', border: 'rgba(46,108,84,.32)' };
    default:      return { bg: '#fff',                   fg: 'var(--ink-soft, #475569)', border: 'rgba(15,40,85,0.18)' };
  }
}

// ─── Shared bits ──────────────────────────────────────────────
function ToolbarRow({ onAdd, addLabel, addDisabled, left, right }: { onAdd?: () => void; addLabel?: string; addDisabled?: boolean; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
      {left}
      {onAdd && (
        <button onClick={onAdd} disabled={addDisabled} style={{
          padding: '9px 16px', borderRadius: 8,
          background: addDisabled ? 'rgba(15,40,85,0.25)' : 'linear-gradient(180deg,#1A3F7E,#0F2855)',
          color: '#fff', border: 'none', cursor: addDisabled ? 'not-allowed' : 'pointer',
          fontSize: 11, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', fontFamily: 'inherit',
        }}>+ {addLabel}</button>
      )}
      <div style={{ marginLeft: 'auto' }}>{right}</div>
    </div>
  );
}
function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 12, padding: '12px 16px', borderRadius: 10, background: 'rgba(178,79,55,0.08)', border: '1px solid rgba(178,79,55,0.32)', color: 'var(--rust, #B5483D)', fontSize: 13 }}>{children}</div>;
}
function Empty({ label, padded }: { label: string; padded?: boolean }) {
  return <div style={{ padding: padded ? 40 : 24, color: 'var(--ink-soft)', fontStyle: 'italic', textAlign: 'center', fontSize: 13.5 }}>{label}</div>;
}
function ModalShell({ title, onClose, onSave, children }: { title: string; onClose: () => void; onSave: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(15,40,85,0.42)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--paper, #F8F4EC)', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 30px 80px rgba(0,0,0,0.32)', padding: '22px 26px' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink, #0F2855)', marginBottom: 16 }}>{title}</div>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '9px 14px', borderRadius: 6, background: 'transparent', color: 'var(--ink-soft)', border: '1px solid rgba(15,40,85,0.22)', fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={onSave} style={{ padding: '9px 18px', borderRadius: 6, background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
        </div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
function Pill({ tone, children }: { tone: 'sage' | 'rust' | 'amber' | 'navy'; children: React.ReactNode }) {
  const p = tone === 'sage' ? { bg: 'rgba(46,108,84,.12)',  fg: 'var(--sage, #2E6C54)' }
          : tone === 'rust' ? { bg: 'rgba(178,79,55,.14)',  fg: 'var(--rust)' }
          : tone === 'amber'? { bg: 'rgba(217,165,69,.16)', fg: 'var(--amber, #B58430)' }
          :                    { bg: 'rgba(15,40,85,.08)',  fg: 'var(--navy-deep, #0F2855)' };
  return <span style={{ background: p.bg, color: p.fg, fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4 }}>{children}</span>;
}
function BtnLink({ onClick, tone, children }: { onClick: () => void; tone?: 'rust'; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: tone === 'rust' ? 'var(--rust)' : 'var(--navy-deep, #0F2855)', fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', fontFamily: 'inherit', marginLeft: 12 }}>{children}</button>;
}

const cardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(15,40,85,0.10)', borderRadius: 12, overflow: 'hidden' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const theadStyle: React.CSSProperties = { background: 'rgba(15,40,85,0.04)', borderBottom: '1px solid rgba(15,40,85,0.10)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid rgba(15,40,85,0.18)', borderRadius: 8, fontSize: 13, color: 'var(--ink)', background: '#fff', fontFamily: 'inherit', outline: 'none' };

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '11px 16px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ textAlign: align || 'left', padding: '11px 16px', color: 'var(--ink)', verticalAlign: 'middle' }}>{children}</td>;
}
