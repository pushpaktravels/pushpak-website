// ============================================================
// /portal/tasks — the shared task / reminder inbox.
// ============================================================
// Personal inbox (every role has it). Scope tabs Mine / Department / All
// (All is owner/admin only), a status filter, quick-add, and per-row
// Done / Snooze. Tasks created by the reservation hold-clock, visa
// appointments, package vouchers and lead follow-ups all land here.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Task = {
  id: string; kind: string; title: string; details: string | null;
  department: string | null; status: string; priority: string;
  dueAt: string | null; remindAt: string | null;
  assigneeExecId: string | null; assigneeName: string | null;
  relatedType: string | null; relatedId: string | null; relatedLabel: string | null;
  createdAt: string;
};

const SCOPES = [
  { key: 'mine', label: 'My Tasks' },
  { key: 'department', label: 'Department' },
  { key: 'all', label: 'All' },
];
const STATUSES = ['open', 'in_progress', 'snoozed', 'done', 'cancelled'];
const KIND_LABEL: Record<string, string> = {
  reservation_hold: 'Hold', travel_reminder: 'Travel', visa_appointment: 'Visa',
  package_voucher: 'Voucher', lead_followup: 'Lead', promise: 'Promise', generic: 'Task',
};
const PRIO_COLOR: Record<string, string> = {
  urgent: '#B5483D', high: '#C98A14', normal: 'var(--ink-soft)', low: 'var(--ink-soft)',
};

export default function TasksPage() {
  const [scope, setScope] = useState('mine');
  const [statusFilter, setStatusFilter] = useState('');
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState('normal');

  function load() {
    setError(null);
    const p = new URLSearchParams({ scope });
    if (statusFilter) p.set('status', statusFilter);
    fetch(`/api/tasks?${p.toString()}`)
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed'); setTasks(r.tasks || []); })
      .catch(e => setError(e.message));
  }
  useEffect(load, [scope, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!title.trim()) return;
    setAdding(true);
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), dueAt: dueAt ? new Date(dueAt).toISOString() : null, priority }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Could not add');
      setTitle(''); setDueAt(''); setPriority('normal'); load();
    } catch (e: any) { setError(e.message); }
    finally { setAdding(false); }
  }

  async function patch(id: string, body: any) {
    try {
      const r = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Update failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <AppShell title="Tasks" crumb="Tasks">
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCOPES.map(s => (
          <button key={s.key} onClick={() => setScope(s.key)} style={chip(scope === s.key)}>{s.label}</button>
        ))}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...sel, marginLeft: 'auto' }}>
          <option value="">Active (open + snoozed)</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Quick add */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a task…"
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          style={{ ...inp, flex: 1, minWidth: 220 }} />
        <input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} style={{ ...inp, width: 200 }} title="Due / reminder" />
        <select value={priority} onChange={e => setPriority(e.target.value)} style={sel}>
          <option value="low">Low</option><option value="normal">Normal</option>
          <option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <button onClick={add} disabled={adding || !title.trim()} style={btnPrimary}>Add</button>
      </div>

      {error && <div style={{ padding: 12, color: 'var(--rust)' }}>{error}</div>}
      {tasks === null && !error && <div style={{ padding: 32, color: 'var(--ink-soft)' }}>Loading…</div>}
      {tasks && tasks.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>Nothing here. You're all caught up.</div>
      )}

      {tasks && tasks.length > 0 && (
        <div style={{ borderRadius: 12, border: '1px solid rgba(15,40,85,0.10)', overflow: 'hidden' }}>
          {tasks.map(t => {
            const overdue = t.dueAt && new Date(t.dueAt) < new Date() && t.status !== 'done';
            const done = t.status === 'done' || t.status === 'cancelled';
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid rgba(15,40,85,0.06)', opacity: done ? 0.55 : 1 }}>
                <input type="checkbox" checked={done} onChange={() => patch(t.id, { status: done ? 'open' : 'done' })} style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--navy-deep, #1A3F7E)', background: 'rgba(15,40,85,0.06)', padding: '2px 7px', borderRadius: 5 }}>{KIND_LABEL[t.kind] || t.kind}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: done ? 'line-through' : 'none' }}>{t.title}</div>
                  {(t.relatedLabel || t.assigneeName) && (
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                      {t.relatedLabel}{t.relatedLabel && t.assigneeName ? ' · ' : ''}{t.assigneeName ? `@${t.assigneeName}` : ''}
                    </div>
                  )}
                </div>
                {t.priority !== 'normal' && <span style={{ fontSize: 11, fontWeight: 700, color: PRIO_COLOR[t.priority] }}>{t.priority}</span>}
                {t.dueAt && <span style={{ fontSize: 12, color: overdue ? 'var(--rust, #B5483D)' : 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{fmtWhen(t.dueAt)}</span>}
                {!done && (
                  <button onClick={() => patch(t.id, { status: 'snoozed', snoozedUntil: tomorrow() })} style={btnLink} title="Snooze to tomorrow">Snooze</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function tomorrow(): string {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, border: active ? '1px solid var(--navy-deep, #1A3F7E)' : '1px solid rgba(15,40,85,0.2)', background: active ? 'var(--navy-deep, #1A3F7E)' : '#fff', color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,40,85,0.2)', fontSize: 13, boxSizing: 'border-box' };
const sel: React.CSSProperties = { ...inp };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, background: 'var(--navy-deep, #1A3F7E)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnLink: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--navy-deep, #1A3F7E)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 };
