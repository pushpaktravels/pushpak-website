// ============================================================
// /portal/reco — reconciliation status board.
// ============================================================
// Replaces Shashank's daily bank-reco Excel and Reeta's airline-reco Excel
// with a live board: every account that must be reconciled, grouped by kind,
// showing at a glance whether it is done for the current period or still
// pending. Mark done (optionally with statement/book balances → auto-flags a
// mismatch); undo; managers can add/remove accounts. Portal-only — nothing
// here talks to FinBook.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useConfirm } from '../../components/ConfirmProvider';
import { fmtINR, fmtDate } from '../../lib/fmt';
import { RECO_KINDS, RECO_KIND_LABEL, RECO_CADENCES, RECO_CADENCE_LABEL, RECO_STATUS_COLOR } from '../../lib/reco';

type Last = {
  periodKey: string; periodLabel: string | null; status: string;
  statementBalance: number | string | null; bookBalance: number | string | null; difference: number | string | null;
  note: string | null; reconciledByName: string | null; reconciledAt: string | null;
};
type Account = {
  id: string; kind: string; name: string; identifier: string | null; cadence: string;
  department: string | null; ownerName: string | null; sortOrder: number; active: boolean;
  currentPeriodKey: string; currentPeriodLabel: string; upToDate: boolean; status: string; last: Last | null;
};
type Summary = { total: number; done: number; flagged: number; pending: number };

const APPROVER_ROLES = new Set(['owner', 'admin', 'cm-accounts']);
const STATUS_LABEL: Record<string, string> = { done: 'Reconciled', flagged: 'Flagged', pending: 'Pending' };

export default function RecoPage() {
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState<Account[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const confirm = useConfirm();

  const canManage = me ? APPROVER_ROLES.has(me.role) : false;

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(r => { if (r?.ok && r.user) setMe({ role: r.user.role }); }).catch(() => {});
  }, []);

  function load() {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    fetch(`/api/reco?${params.toString()}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRows(r.data.accounts || []);
        setSummary(r.data.summary || null);
      })
      .catch(e => setError(e.message));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function mark(a: Account, payload: { statementBalance?: number | null; bookBalance?: number | null; note?: string | null } = {}) {
    try {
      const res = await fetch(`/api/reco/${encodeURIComponent(a.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark', ...payload }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Update failed');
      setExpanded(null);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function unmark(a: Account) {
    try {
      const res = await fetch(`/api/reco/${encodeURIComponent(a.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unmark' }),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Update failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove(a: Account) {
    const ok = await confirm({ title: `Delete "${a.name}"?`, body: 'Removes the account and its full reconciliation history.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/reco/${encodeURIComponent(a.id)}`, { method: 'DELETE' }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Delete failed');
      load();
    } catch (e: any) { setError(e.message); }
  }

  const grouped = RECO_KINDS.map(k => ({ kind: k, items: (rows || []).filter(r => r.kind === k) })).filter(g => g.items.length > 0);

  return (
    <AppShell title="Reconciliation" crumb="Reconciliation">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Reconciliation Board</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            One place for bank and airline reconciliation. Mark each account done for its period — optionally with the statement vs book balance, which auto-flags any mismatch. (Portal-only — nothing here posts to FinBook.)
          </p>
        </div>
        {canManage && <button onClick={() => setAdding(v => !v)} style={addBtn}>{adding ? 'CLOSE' : '+ ADD ACCOUNT'}</button>}
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}

      {adding && canManage && <AddForm onSaved={() => { setAdding(false); load(); }} onError={setError} />}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, margin: '4px 0 18px' }}>
        <Stat label="Accounts" value={summary ? String(summary.total) : '—'} color="var(--t-1)" />
        <Stat label="Reconciled" value={summary ? String(summary.done) : '—'} color={RECO_STATUS_COLOR.done} />
        <Stat label="Flagged" value={summary ? String(summary.flagged) : '—'} color={RECO_STATUS_COLOR.flagged} sub="balances don't tie" />
        <Stat label="Pending" value={summary ? String(summary.pending) : '—'} color={summary && summary.pending > 0 ? RECO_STATUS_COLOR.pending : 'var(--t-3)'} sub="due this period" />
      </div>

      {/* Kind filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setKind('')} style={chip(kind === '')}>All</button>
        {RECO_KINDS.map(k => <button key={k} onClick={() => setKind(k)} style={chip(kind === k)}>{RECO_KIND_LABEL[k]}s</button>)}
      </div>

      {!rows && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={emptyBox}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No accounts yet</h3>
          <p style={{ color: 'var(--t-2)' }}>{canManage ? <>Click <strong>+ Add account</strong> to set up a bank or airline to reconcile.</> : 'A manager hasn’t set up any reconciliation accounts yet.'}</p>
        </div>
      )}

      {grouped.map(g => (
        <div key={g.kind} style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, margin: '0 0 10px' }}>{RECO_KIND_LABEL[g.kind]}s</h3>
          <div style={cardBox}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                  <Th>Account</Th><Th>Period</Th><Th>Status</Th><Th>Last reconciled</Th><Th align="right">Difference</Th><Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {g.items.map(a => (
                  <RecoRow key={a.id} a={a} canManage={canManage} expanded={expanded === a.id}
                    onExpand={() => setExpanded(expanded === a.id ? null : a.id)}
                    onMark={mark} onUnmark={unmark} onRemove={remove} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </AppShell>
  );
}

// ─── One account row (with optional balances editor) ──────────
function RecoRow({ a, canManage, expanded, onExpand, onMark, onUnmark, onRemove }: {
  a: Account; canManage: boolean; expanded: boolean; onExpand: () => void;
  onMark: (a: Account, p?: { statementBalance?: number | null; bookBalance?: number | null; note?: string | null }) => void;
  onUnmark: (a: Account) => void; onRemove: (a: Account) => void;
}) {
  const [stmt, setStmt] = useState('');
  const [book, setBook] = useState('');
  const [note, setNote] = useState('');
  const color = RECO_STATUS_COLOR[a.status] || 'var(--t-2)';
  const diff = a.last?.difference != null ? Number(a.last.difference) : null;

  return (
    <>
      <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--line, #e7eaf0)', opacity: a.active ? 1 : 0.55 }}>
        <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
          <div style={{ color: 'var(--navy-deep)', fontWeight: 600 }}>{a.name}</div>
          <div style={{ fontSize: 10.5, color: 'var(--t-3)' }}>
            {a.identifier ? `${a.identifier} · ` : ''}{RECO_CADENCE_LABEL[a.cadence]}{a.ownerName ? ` · ${a.ownerName}` : ''}
          </div>
        </td>
        <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{a.currentPeriodLabel}</span></td>
        <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color }}>{STATUS_LABEL[a.status] || a.status}</span>
        </td>
        <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
          {a.last && a.upToDate ? (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--t-1)' }}>{a.last.reconciledByName || '—'}</div>
              <div style={{ fontSize: 10.5, color: 'var(--t-3)' }}>{a.last.reconciledAt ? fmtDate(a.last.reconciledAt) : ''}{a.last.note ? ` · “${a.last.note}”` : ''}</div>
            </div>
          ) : a.last ? (
            <span style={{ fontSize: 11.5, color: 'var(--t-3)' }}>last: {a.last.periodLabel || a.last.periodKey}</span>
          ) : <span style={{ fontSize: 11.5, color: 'var(--t-3)' }}>never</span>}
        </td>
        <td style={{ padding: '10px 14px', textAlign: 'right', verticalAlign: 'middle' }}>
          {a.upToDate && diff != null ? (
            <span style={{ fontWeight: 700, color: Math.abs(diff) >= 0.01 ? RECO_STATUS_COLOR.flagged : RECO_STATUS_COLOR.done }}>{fmtINR(diff)}</span>
          ) : <span style={{ color: 'var(--t-3)' }}>—</span>}
        </td>
        <td style={{ padding: '10px 14px', textAlign: 'right', verticalAlign: 'middle' }}>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {!a.upToDate && <RowBtn onClick={() => onMark(a)}>Mark done</RowBtn>}
            {!a.upToDate && <RowBtn onClick={onExpand}>{expanded ? 'Close' : 'With balances'}</RowBtn>}
            {a.upToDate && <RowBtn onClick={() => onUnmark(a)}>Undo</RowBtn>}
            {canManage && <RowBtn onClick={() => onRemove(a)}>Delete</RowBtn>}
          </div>
        </td>
      </tr>
      {expanded && !a.upToDate && (
        <tr style={{ borderBottom: '1px solid var(--line, #e7eaf0)', background: 'var(--bg-2, #f9fafc)' }}>
          <td colSpan={6} style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <MiniField label="Statement balance"><input type="number" step="0.01" value={stmt} onChange={e => setStmt(e.target.value)} placeholder="0.00" style={{ ...inputStyle, maxWidth: 160 }} /></MiniField>
              <MiniField label="Book balance"><input type="number" step="0.01" value={book} onChange={e => setBook(e.target.value)} placeholder="0.00" style={{ ...inputStyle, maxWidth: 160 }} /></MiniField>
              <MiniField label="Note"><input value={note} onChange={e => setNote(e.target.value)} placeholder="Anything to flag" style={{ ...inputStyle, minWidth: 220 }} /></MiniField>
              <button onClick={() => onMark(a, { statementBalance: stmt === '' ? null : Number(stmt), bookBalance: book === '' ? null : Number(book), note: note || null })} style={{ ...addBtn, padding: '9px 16px' }}>SAVE & MARK DONE</button>
              {stmt !== '' && book !== '' && (
                <span style={{ fontSize: 12, color: Math.abs(Number(stmt) - Number(book)) >= 0.01 ? RECO_STATUS_COLOR.flagged : RECO_STATUS_COLOR.done, fontWeight: 700, alignSelf: 'center' }}>
                  Diff {fmtINR(Number(stmt) - Number(book))}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Add-account form ─────────────────────────────────────────
function AddForm({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ kind: 'bank', name: '', identifier: '', cadence: 'daily', ownerName: '', department: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { onError('Enter the account name.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/reco', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      }).then(x => x.json());
      if (!res?.ok) throw new Error(res?.error || 'Save failed');
      onSaved();
    } catch (e: any) { onError(e.message); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Type *"><select value={f.kind} onChange={e => set('kind', e.target.value)} style={inputStyle}>{RECO_KINDS.map(k => <option key={k} value={k}>{RECO_KIND_LABEL[k]}</option>)}</select></Field>
        <Field label="Name *"><input value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. HDFC Current A/c · IndiGo" style={inputStyle} /></Field>
        <Field label="Identifier"><input value={f.identifier} onChange={e => set('identifier', e.target.value)} placeholder="A/c no / airline code" style={inputStyle} /></Field>
        <Field label="Cadence"><select value={f.cadence} onChange={e => set('cadence', e.target.value)} style={inputStyle}>{RECO_CADENCES.map(c => <option key={c} value={c}>{RECO_CADENCE_LABEL[c]}</option>)}</select></Field>
        <Field label="Reconciled by"><input value={f.ownerName} onChange={e => set('ownerName', e.target.value)} placeholder="Person normally responsible" style={inputStyle} /></Field>
        <Field label="Department"><input value={f.department} onChange={e => set('department', e.target.value)} placeholder="Optional" style={inputStyle} /></Field>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <button type="submit" disabled={saving} style={addBtn}>{saving ? 'SAVING…' : 'ADD ACCOUNT'}</button>
      </div>
    </form>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Stat({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={statCard}>
      <div style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '11px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function RowBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: '#fff', color: 'var(--t-2)', border: '1px solid var(--line-2, #d0d6e0)', borderRadius: 6, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--navy)'; e.currentTarget.style.color = 'var(--navy)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2, #d0d6e0)'; e.currentTarget.style.color = 'var(--t-2)'; }}>
      {children}
    </button>
  );
}

const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, border: active ? '1px solid var(--navy-deep, #1A3F7E)' : '1px solid rgba(15,40,85,0.2)', background: active ? 'var(--navy-deep, #1A3F7E)' : '#fff', color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff' };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(15,40,85,.18)' };
const statCard: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: '12px 14px' };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const emptyBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' };
