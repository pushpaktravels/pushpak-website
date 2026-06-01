// ============================================================
// Employees — the attendance/payroll employee master.
// ============================================================
// Enrich biometric-bootstrapped stubs (fill HR code, salary, weekly-off,
// shift, joining date), import the master sheet, and review proposed
// machine-code ↔ employee matches.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Employee = {
  id: string;
  machineCode: string | null;
  loginExecId: string | null;
  hrCode: string;
  name: string;
  department: string | null;
  designation: string | null;
  mobile: string | null;
  email: string | null;
  dob: string | null;
  joiningDate: string | null;
  monthlySalary: string | number;
  shiftIn: string | null;
  shiftOut: string | null;
  weeklyOffDay: number;
  leavesCarryOver: boolean;
  carryOverDays: string | number;
  active: boolean;
};

type Proposal = {
  stubId: string; machineCode: string; stubName: string;
  masterId: string; masterHrCode: string; masterName: string;
  score: number; confidence: 'high' | 'medium' | 'low';
};

type LoginProposal = {
  employeeId: string; employeeName: string; hrCode: string;
  execId: string; userName: string; role: string;
  score: number; confidence: 'high' | 'medium' | 'low';
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function EmployeesPage() {
  return (
    <AppShell title="Employees" crumb="Employees">
      <EmployeesInner />
    </AppShell>
  );
}

function EmployeesInner() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loginProposals, setLoginProposals] = useState<LoginProposal[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  // Per-column filters (tucked inside each header cell). Empty string = "All".
  const [filters, setFilters] = useState({
    name: '', hrCode: '', machine: '', login: '',
    dept: '', shift: '', weeklyOff: '', salary: '', status: '',
  });
  const setFilter = (k: keyof typeof filters, v: string) =>
    setFilters(f => ({ ...f, [k]: v }));
  const clearFilters = () => {
    setFilters({ name: '', hrCode: '', machine: '', login: '', dept: '', shift: '', weeklyOff: '', salary: '', status: '' });
    setSearch('');
  };
  const anyFilter = !!search.trim() || Object.values(filters).some(Boolean);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Distinct dropdown options, derived from the loaded rows.
  const shiftLabel = (e: Employee) => (e.shiftIn && e.shiftOut ? `${e.shiftIn}–${e.shiftOut}` : '');
  const deptOpts = useMemo(
    () => Array.from(new Set(employees.map(e => e.department).filter(Boolean) as string[])).sort(),
    [employees]
  );
  const shiftOpts = useMemo(
    () => Array.from(new Set(employees.map(shiftLabel).filter(Boolean))).sort(),
    [employees]
  );
  const weeklyOffOpts = useMemo(
    () => Array.from(new Set(employees.map(e => DAYS[e.weeklyOffDay]).filter(Boolean)))
      .sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)),
    [employees]
  );

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/attendance/employees');
      const d = await r.json();
      if (!d.ok) setError(d.error || 'Failed to load');
      else setEmployees(d.employees);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const stubs = employees.filter(e => e.hrCode.startsWith('BIO-'));
  const needsEnrich = employees.filter(e => e.hrCode.startsWith('BIO-') || Number(e.monthlySalary) === 0);

  const q = search.trim().toLowerCase();
  const visible = employees.filter(e => {
    // Active/exited visibility — the Status column filter wins when set,
    // otherwise the "Show exited" checkbox governs.
    if (filters.status === 'active' && !e.active) return false;
    if (filters.status === 'exited' && e.active) return false;
    if (!filters.status && !showInactive && !e.active) return false;

    // Global search box (matches across several fields).
    if (q && ![e.name, e.hrCode, e.machineCode, e.department, e.designation, e.loginExecId]
      .some(v => (v ?? '').toLowerCase().includes(q))) return false;

    // Per-column filters (AND-combined).
    if (filters.name && !e.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.hrCode && !e.hrCode.toLowerCase().includes(filters.hrCode.toLowerCase())) return false;
    if (filters.machine && !(e.machineCode ?? '').toLowerCase().includes(filters.machine.toLowerCase())) return false;
    if (filters.login === 'linked' && !e.loginExecId) return false;
    if (filters.login === 'unlinked' && e.loginExecId) return false;
    if (filters.dept && (e.department ?? '') !== filters.dept) return false;
    if (filters.shift && shiftLabel(e) !== filters.shift) return false;
    if (filters.weeklyOff && (DAYS[e.weeklyOffDay] ?? '') !== filters.weeklyOff) return false;
    if (filters.salary === 'has' && !(Number(e.monthlySalary) > 0)) return false;
    if (filters.salary === 'none' && Number(e.monthlySalary) > 0) return false;
    return true;
  });

  async function importMaster(file: File) {
    setImportMsg('Importing…'); setError(null); setProposals([]);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch('/api/attendance/import-master', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Import failed'); setImportMsg(null); return; }
      const s = d.summary;
      setImportMsg(`Imported: ${s.created} new, ${s.updated} updated, ${s.skipped} skipped.${s.proposals.length ? ` ${s.proposals.length} code match(es) to review below.` : ''}`);
      setProposals(s.proposals || []);
      load();
    } catch (e: any) { setError(e.message); setImportMsg(null); }
  }

  async function confirmMatches(confs: { stubId: string; masterId: string }[]) {
    if (confs.length === 0) return;
    try {
      const r = await fetch('/api/attendance/match-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmations: confs }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Match failed'); return; }
      setProposals([]); setImportMsg(`Linked ${d.linked} machine code(s).`);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function matchLogins() {
    setImportMsg('Finding login matches…'); setError(null); setLoginProposals([]);
    try {
      const r = await fetch('/api/attendance/login-matches');
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Could not load login matches'); setImportMsg(null); return; }
      if ((d.proposals || []).length === 0) { setImportMsg('No new login matches found — everyone is either linked or has no matching login.'); return; }
      setLoginProposals(d.proposals);
      setImportMsg(`${d.proposals.length} login match(es) to review below.`);
    } catch (e: any) { setError(e.message); setImportMsg(null); }
  }

  async function confirmLoginLinks(confs: { employeeId: string; execId: string }[]) {
    if (confs.length === 0) return;
    try {
      const r = await fetch('/api/attendance/login-matches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmations: confs }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Link failed'); return; }
      setLoginProposals([]); setImportMsg(`Linked ${d.linked} login(s) to employees.`);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function toggleActive(emp: Employee) {
    const action = emp.active ? 'exit' : 'restore';
    if (emp.active && !confirm(`Exit ${emp.name}? They'll be deactivated and can no longer log in, but all their attendance history is kept. You can restore them later.`)) return;
    try {
      const r = await fetch('/api/attendance/employees', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emp.id, active: !emp.active }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || `Could not ${action} employee`); return; }
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Employees</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          {employees.length} total · {stubs.length} from biometric · {needsEnrich.length} need details
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importMaster(f); e.currentTarget.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} style={btnSecondary}>Import Master Sheet</button>
          <button onClick={matchLogins} style={btnSecondary}>Match Logins</button>
          <button onClick={() => setEditing(blankEmployee())} style={btnPrimary}>+ Add Employee</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, code, dept, login…"
          style={{ ...inp, maxWidth: 320 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-soft)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show exited employees
        </label>
        {anyFilter && (
          <button onClick={clearFilters} style={{ ...btnLink, color: 'var(--rust, #B5483D)' }}>
            Clear filters
          </button>
        )}
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {importMsg && <Banner kind="info">{importMsg}</Banner>}

      {proposals.length > 0 && (
        <MatchReview proposals={proposals} onConfirm={confirmMatches} onDismiss={() => setProposals([])} />
      )}

      {loginProposals.length > 0 && (
        <LoginMatchReview proposals={loginProposals} onConfirm={confirmLoginLinks} onDismiss={() => setLoginProposals([])} />
      )}

      {loading ? (
        <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(15,40,85,0.04)', textAlign: 'left', verticalAlign: 'top' }}>
                <th style={th}>Name
                  <input style={filterInp} value={filters.name} onChange={e => setFilter('name', e.target.value)} placeholder="filter…" />
                </th>
                <th style={th}>HR Code
                  <input style={filterInp} value={filters.hrCode} onChange={e => setFilter('hrCode', e.target.value)} placeholder="filter…" />
                </th>
                <th style={th}>Machine
                  <input style={filterInp} value={filters.machine} onChange={e => setFilter('machine', e.target.value)} placeholder="filter…" />
                </th>
                <th style={th}>Login
                  <select style={filterInp} value={filters.login} onChange={e => setFilter('login', e.target.value)}>
                    <option value="">All</option>
                    <option value="linked">Linked</option>
                    <option value="unlinked">Not linked</option>
                  </select>
                </th>
                <th style={th}>Dept
                  <select style={filterInp} value={filters.dept} onChange={e => setFilter('dept', e.target.value)}>
                    <option value="">All</option>
                    {deptOpts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </th>
                <th style={th}>Shift
                  <select style={filterInp} value={filters.shift} onChange={e => setFilter('shift', e.target.value)}>
                    <option value="">All</option>
                    {shiftOpts.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </th>
                <th style={th}>Weekly Off
                  <select style={filterInp} value={filters.weeklyOff} onChange={e => setFilter('weeklyOff', e.target.value)}>
                    <option value="">All</option>
                    {weeklyOffOpts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </th>
                <th style={th}>Salary
                  <select style={filterInp} value={filters.salary} onChange={e => setFilter('salary', e.target.value)}>
                    <option value="">All</option>
                    <option value="has">Has salary</option>
                    <option value="none">No salary</option>
                  </select>
                </th>
                <th style={th}>Status
                  <select style={filterInp} value={filters.status} onChange={e => setFilter('status', e.target.value)}>
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="exited">Exited</option>
                  </select>
                </th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td style={{ ...td, color: 'var(--ink-soft)' }} colSpan={10}>No employees match.</td></tr>
              ) : visible.map(e => {
                const stub = e.hrCode.startsWith('BIO-');
                const noSalary = Number(e.monthlySalary) === 0;
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid rgba(15,40,85,0.06)', opacity: e.active ? 1 : 0.6 }}>
                    <td style={td}>
                      {e.name}
                      {(stub || noSalary) && <span style={pill('rust')}>needs details</span>}
                    </td>
                    <td style={td}>{stub ? <span style={{ color: 'var(--ink-soft)' }}>{e.hrCode}</span> : e.hrCode}</td>
                    <td style={td}>{e.machineCode || '—'}</td>
                    <td style={td}>{e.loginExecId ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{e.loginExecId}</span> : <span style={pill('muted')}>not linked</span>}</td>
                    <td style={td}>{e.department || '—'}</td>
                    <td style={td}>{e.shiftIn && e.shiftOut ? `${e.shiftIn}–${e.shiftOut}` : '—'}</td>
                    <td style={td}>{DAYS[e.weeklyOffDay] ?? '—'}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                      {Number(e.monthlySalary) > 0 ? `₹${Number(e.monthlySalary).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td style={td}>{e.active ? <span style={pill('sage')}>active</span> : <span style={pill('muted')}>inactive</span>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditing(e)} style={btnLink}>Edit</button>
                      <button onClick={() => toggleActive(e)} style={{ ...btnLink, marginLeft: 12, color: e.active ? 'var(--rust, #B5483D)' : 'var(--sage, #2E6C54)' }}>
                        {e.active ? 'Exit' : 'Restore'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditDrawer
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function MatchReview({ proposals, onConfirm, onDismiss }: {
  proposals: Proposal[];
  onConfirm: (c: { stubId: string; masterId: string }[]) => void;
  onDismiss: () => void;
}) {
  // default-select high & medium confidence
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(proposals.filter(p => p.confidence !== 'low').map(p => p.stubId))
  );
  function toggle(id: string) {
    setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const confColor = (c: string) => c === 'high' ? 'sage' : c === 'medium' ? 'gold' : 'rust';
  return (
    <div style={{ marginBottom: 20, padding: 18, borderRadius: 12, border: '1px solid rgba(201,164,114,0.4)', background: 'rgba(201,164,114,0.06)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Review machine-code matches</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        We matched biometric names to your master sheet. Confirm to lock in each machine code permanently.
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {proposals.map(p => (
          <label key={p.stubId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fff', borderRadius: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={picked.has(p.stubId)} onChange={() => toggle(p.stubId)} />
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, minWidth: 44 }}>#{p.machineCode}</span>
            <span style={{ flex: 1 }}>
              <b>{p.stubName}</b> <span style={{ color: 'var(--ink-soft)' }}>→ {p.masterName} ({p.masterHrCode})</span>
            </span>
            <span style={pill(confColor(p.confidence) as any)}>{p.confidence} · {p.score}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={() => onConfirm(proposals.filter(p => picked.has(p.stubId)).map(p => ({ stubId: p.stubId, masterId: p.masterId })))} style={btnPrimary}>
          Confirm {picked.size} match{picked.size === 1 ? '' : 'es'}
        </button>
        <button onClick={onDismiss} style={btnSecondary}>Dismiss</button>
      </div>
    </div>
  );
}

function LoginMatchReview({ proposals, onConfirm, onDismiss }: {
  proposals: LoginProposal[];
  onConfirm: (c: { employeeId: string; execId: string }[]) => void;
  onDismiss: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(proposals.filter(p => p.confidence !== 'low').map(p => p.employeeId))
  );
  function toggle(id: string) {
    setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const confColor = (c: string) => c === 'high' ? 'sage' : c === 'medium' ? 'gold' : 'rust';
  return (
    <div style={{ marginBottom: 20, padding: 18, borderRadius: 12, border: '1px solid rgba(26,63,126,0.35)', background: 'rgba(26,63,126,0.05)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Review login matches</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        We matched each employee to an existing portal login by name. Confirm to link them — the employee then sees their own attendance when they log in.
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {proposals.map(p => (
          <label key={p.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fff', borderRadius: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={picked.has(p.employeeId)} onChange={() => toggle(p.employeeId)} />
            <span style={{ flex: 1 }}>
              <b>{p.employeeName}</b> <span style={{ color: 'var(--ink-soft)' }}>({p.hrCode})</span>
              <span style={{ color: 'var(--ink-soft)' }}> → login </span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{p.execId}</b>
              <span style={{ color: 'var(--ink-soft)' }}> · {p.userName} · {p.role}</span>
            </span>
            <span style={pill(confColor(p.confidence) as any)}>{p.confidence} · {p.score}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={() => onConfirm(proposals.filter(p => picked.has(p.employeeId)).map(p => ({ employeeId: p.employeeId, execId: p.execId })))} style={btnPrimary}>
          Link {picked.size} login{picked.size === 1 ? '' : 's'}
        </button>
        <button onClick={onDismiss} style={btnSecondary}>Dismiss</button>
      </div>
    </div>
  );
}

function EditDrawer({ employee, onClose, onSaved, onError }: {
  employee: Employee; onClose: () => void; onSaved: () => void; onError: (s: string) => void;
}) {
  const [f, setF] = useState<Employee>({ ...employee });
  const [saving, setSaving] = useState(false);
  const isNew = !employee.id;
  function set<K extends keyof Employee>(k: K, v: Employee[K]) { setF(p => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true);
    const payload: any = {
      hrCode: f.hrCode, name: f.name,
      machineCode: emptyToNull(f.machineCode), loginExecId: emptyToNull(f.loginExecId), department: emptyToNull(f.department),
      designation: emptyToNull(f.designation), mobile: emptyToNull(f.mobile), email: emptyToNull(f.email),
      dob: emptyToNull(f.dob), joiningDate: emptyToNull(f.joiningDate),
      monthlySalary: Number(f.monthlySalary) || 0,
      shiftIn: emptyToNull(f.shiftIn), shiftOut: emptyToNull(f.shiftOut),
      weeklyOffDay: Number(f.weeklyOffDay) || 0,
      leavesCarryOver: !!f.leavesCarryOver, carryOverDays: Number(f.carryOverDays) || 0,
      active: !!f.active,
    };
    if (!isNew) payload.id = employee.id;
    try {
      const r = await fetch('/api/attendance/employees', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!d.ok) { onError(d.error || 'Save failed'); setSaving(false); return; }
      onSaved();
    } catch (e: any) { onError(e.message); setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,0.4)', zIndex: 900, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', height: '100%', background: '#fff', overflowY: 'auto', padding: 26, boxShadow: '-8px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{isNew ? 'Add Employee' : f.name}</h2>
          <button onClick={onClose} style={btnLink}>Close</button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Name"><input style={inp} value={f.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="HR Code (E-001)"><input style={inp} value={f.hrCode} onChange={e => set('hrCode', e.target.value)} /></Field>
          <Field label="Machine Code"><input style={inp} value={f.machineCode || ''} onChange={e => set('machineCode', e.target.value)} /></Field>
          <Field label="Portal Login">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input style={{ ...inp, color: 'var(--ink-soft)' }} value={f.loginExecId || 'Not linked — use “Match Logins”'} readOnly />
              {f.loginExecId && <button type="button" onClick={() => set('loginExecId', null)} style={btnLink}>Unlink</button>}
            </div>
          </Field>
          <Row>
            <Field label="Department"><input style={inp} value={f.department || ''} onChange={e => set('department', e.target.value)} /></Field>
            <Field label="Designation"><input style={inp} value={f.designation || ''} onChange={e => set('designation', e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Mobile"><input style={inp} value={f.mobile || ''} onChange={e => set('mobile', e.target.value)} /></Field>
            <Field label="Email"><input style={inp} value={f.email || ''} onChange={e => set('email', e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Shift In (HH:MM)"><input style={inp} placeholder="09:30" value={f.shiftIn || ''} onChange={e => set('shiftIn', e.target.value)} /></Field>
            <Field label="Shift Out (HH:MM)"><input style={inp} placeholder="18:30" value={f.shiftOut || ''} onChange={e => set('shiftOut', e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Weekly Off">
              <select style={inp} value={f.weeklyOffDay} onChange={e => set('weeklyOffDay', Number(e.target.value) as any)}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </Field>
            <Field label="Monthly Salary (₹)"><input style={inp} type="number" value={f.monthlySalary} onChange={e => set('monthlySalary', e.target.value as any)} /></Field>
          </Row>
          <Row>
            <Field label="DOB"><input style={inp} type="date" value={f.dob || ''} onChange={e => set('dob', e.target.value)} /></Field>
            <Field label="Joining Date"><input style={inp} type="date" value={f.joiningDate || ''} onChange={e => set('joiningDate', e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Leaves Carry Over">
              <select style={inp} value={f.leavesCarryOver ? '1' : '0'} onChange={e => set('leavesCarryOver', e.target.value === '1' as any)}>
                <option value="0">No</option><option value="1">Yes</option>
              </select>
            </Field>
            <Field label="Carry-over Days"><input style={inp} type="number" value={f.carryOverDays} onChange={e => set('carryOverDays', e.target.value as any)} /></Field>
          </Row>
          <Field label="Active">
            <select style={inp} value={f.active ? '1' : '0'} onChange={e => set('active', e.target.value === '1' as any)}>
              <option value="1">Active</option><option value="0">Inactive</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── small bits ──────────────────────────────────────────────
function blankEmployee(): Employee {
  return {
    id: '', machineCode: null, loginExecId: null, hrCode: '', name: '', department: null, designation: null,
    mobile: null, email: null, dob: null, joiningDate: null, monthlySalary: 0,
    shiftIn: null, shiftOut: null, weeklyOffDay: 0, leavesCarryOver: false, carryOverDays: 0, active: true,
  };
}
function emptyToNull(s: string | null): string | null { const t = (s ?? '').trim(); return t ? t : null; }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</span>
    {children}
  </label>;
}
function Row({ children }: { children: React.ReactNode }) { return <div style={{ display: 'flex', gap: 12 }}>{children}</div>; }
function Banner({ kind, children }: { kind: 'error' | 'info'; children: React.ReactNode }) {
  const c = kind === 'error' ? 'rust' : 'navy-deep';
  return <div style={{ marginBottom: 14, padding: '11px 15px', borderRadius: 10, fontSize: 13, color: `var(--${c}, #333)`, background: kind === 'error' ? 'rgba(181,72,61,0.08)' : 'rgba(15,40,85,0.05)', border: `1px solid ${kind === 'error' ? 'rgba(181,72,61,0.25)' : 'rgba(15,40,85,0.15)'}` }}>{children}</div>;
}
const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const td: React.CSSProperties = { padding: '10px 12px', color: 'var(--ink)' };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,40,85,0.2)', fontSize: 13, width: '100%', boxSizing: 'border-box' };
// Compact filter control tucked under each column title in the header cell.
const filterInp: React.CSSProperties = { display: 'block', marginTop: 6, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(15,40,85,0.2)', background: '#fff', fontSize: 11, fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: 'var(--ink)', width: '100%', minWidth: 70, boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, background: '#fff', color: 'var(--ink)', border: '1px solid rgba(15,40,85,0.22)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const btnLink: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--navy-deep, #1A3F7E)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 };
function pill(tone: 'sage' | 'rust' | 'gold' | 'muted'): React.CSSProperties {
  const map = {
    sage: ['rgba(46,108,84,0.12)', '#2E6C54'],
    rust: ['rgba(181,72,61,0.12)', '#B5483D'],
    gold: ['rgba(201,164,114,0.18)', '#9A7634'],
    muted: ['rgba(15,40,85,0.08)', 'var(--ink-soft)'],
  }[tone];
  return { marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: map[0], color: map[1] };
}
