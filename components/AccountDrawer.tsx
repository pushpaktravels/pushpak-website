// ============================================================
// AccountDrawer — slide-in panel showing one account's full record.
// ============================================================
// Opened with an accountId from any list view (Hold Check, Team
// Worklist, Promise Ledger, etc.). 4 tabs:
//   Overview — KPIs + status + financial snapshot
//   Timeline — AccountHistory entries, newest first
//   Contact  — phone / whatsapp / email / owner / VIP flag
//   Promises — open + recent closed promises
//
// Action buttons (Log Call, Add Promise, Approve Hold) live in the
// action bar below the header. Each opens a modal; after a successful
// mutation the drawer re-fetches its data so changes show up live.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { fmtINR, fmtDate, fmtDateTime, fmtRelative } from '../lib/fmt';
import { TierBadge, TierLabel } from './TierBadge';

type Tab = 'overview' | 'timeline' | 'contact' | 'promises';
type ModalKind = null | 'log-call' | 'add-promise' | 'settle-promise' | 'flag-hold';

type DrawerData = {
  account: any;
  client: any | null;
  promises: any[];
  holds: any[];
  history: any[];
};

type Props = {
  accountId: string | null;     // null = closed
  onClose: () => void;
};

export function AccountDrawer({ accountId, onClose }: Props) {
  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<ModalKind>(null);
  const [settlePromiseId, setSettlePromiseId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Reusable loader so mutation flows can re-fetch after a successful save.
  const loadData = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(id)}`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to load account');
      setData(r.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when accountId changes; reset tab to overview on each open.
  useEffect(() => {
    if (!accountId) {
      setData(null);
      setError(null);
      return;
    }
    setTab('overview');
    setModal(null);
    loadData(accountId);
  }, [accountId, loadData]);

  // Called by modals after a successful mutation to refresh drawer state.
  const refresh = useCallback(() => {
    if (accountId) loadData(accountId);
  }, [accountId, loadData]);

  // Close on Esc.
  useEffect(() => {
    if (!accountId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accountId, onClose]);

  if (!accountId) return null;

  const a = data?.account;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(11, 22, 41, 0.45)',
          backdropFilter: 'blur(2px)', zIndex: 100,
        }}
      />
      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-label="Account details"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(640px, 92vw)',
          background: 'var(--bg-1, #fff)',
          boxShadow: '-24px 0 48px rgba(11,22,41,.18)',
          zIndex: 101, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <header style={{
          padding: '20px 28px 16px',
          borderBottom: '1px solid var(--line, #e7eaf0)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>
              {a?.family || 'Account detail'}
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, lineHeight: 1.3, wordBreak: 'break-word' }}>
              {a?.party || (loading ? 'Loading…' : '—')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              padding: 6, color: 'var(--t-2)', fontSize: 22, lineHeight: 1,
            }}
          >×</button>
        </header>

        {/* Action bar — quick mutations available regardless of which tab is open */}
        {a && data && (
          <div style={{
            padding: '12px 28px', borderBottom: '1px solid var(--line, #e7eaf0)',
            display: 'flex', gap: 8, background: 'var(--bg-2, #f6f8fb)', flexWrap: 'wrap',
          }}>
            <ActionButton onClick={() => setModal('log-call')}>📞 Log Call</ActionButton>
            <ActionButton onClick={() => setModal('add-promise')}>➕ Add Promise</ActionButton>
            {/* Contextual hold button — depends on current hold state */}
            {a.onHold === 'Candidate' && (
              <ActionButton onClick={() => approveLatestHold(data, refresh, setActionErr)}>
                ✓ Approve Hold
              </ActionButton>
            )}
            {a.onHold === 'Active' && (
              <ActionButton onClick={() => releaseLatestHold(data, refresh, setActionErr)}>
                ✕ Release Hold
              </ActionButton>
            )}
            {!a.onHold && (
              <ActionButton onClick={() => setModal('flag-hold')}>🚩 Flag Hold</ActionButton>
            )}
          </div>
        )}

        {actionErr && (
          <div style={{
            padding: '8px 28px', background: 'rgba(178,79,55,.10)',
            color: 'var(--rust)', fontSize: 12, borderBottom: '1px solid var(--line, #e7eaf0)',
          }}>{actionErr}</div>
        )}

        {/* Tabs */}
        <nav style={{
          display: 'flex', borderBottom: '1px solid var(--line, #e7eaf0)',
          padding: '0 16px',
        }}>
          {(['overview','timeline','contact','promises'] as const).map(t => {
            const active = tab === t;
            const label = t === 'overview' ? 'Overview' : t === 'timeline' ? 'Timeline' : t === 'contact' ? 'Contact' : 'Promises';
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '14px 16px', fontSize: 12, fontWeight: 600,
                  letterSpacing: '.08em', textTransform: 'uppercase',
                  color: active ? 'var(--navy-deep)' : 'var(--t-3)',
                  borderBottom: active ? '2px solid var(--navy-deep)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >{label}</button>
            );
          })}
        </nav>

        {/* Body */}
        <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading && <div style={{ color: 'var(--t-3)', padding: 24 }}>Loading…</div>}
          {error && <div style={{ color: 'var(--rust)', padding: 24 }}>Failed: {error}</div>}
          {data && tab === 'overview'  && <OverviewTab data={data} />}
          {data && tab === 'timeline'  && <TimelineTab data={data} />}
          {data && tab === 'contact'   && <ContactTab data={data} />}
          {data && tab === 'promises'  && (
            <PromisesTab
              data={data}
              onSettleKept={(id) => { setSettlePromiseId(id); setModal('settle-promise'); }}
              onMarkBroken={(id) => quickSettlePromise(id, 'Broken', refresh, setActionErr)}
              onMarkCancelled={(id) => quickSettlePromise(id, 'Cancelled', refresh, setActionErr)}
            />
          )}
        </div>
      </aside>

      {/* Modals — render last so they layer over the drawer */}
      {modal === 'log-call' && a && (
        <LogCallModal
          party={a.party}
          currentStatus={a.status}
          currentNextFu={a.nextFu}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}
      {modal === 'add-promise' && a && (
        <AddPromiseModal
          party={a.party}
          currentOutstanding={Number(a.bill || 0)}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}
      {modal === 'settle-promise' && settlePromiseId && data && (
        <SettlePromiseModal
          promise={data.promises.find(p => p.id === settlePromiseId)!}
          onClose={() => { setModal(null); setSettlePromiseId(null); }}
          onSaved={() => { setModal(null); setSettlePromiseId(null); refresh(); }}
        />
      )}
      {modal === 'flag-hold' && a && (
        <FlagHoldModal
          party={a.party}
          currentOutstanding={Number(a.bill || 0)}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}
    </>
  );
}

// ─── Module-local mutation helpers (used by inline buttons) ───
async function quickSettlePromise(
  id: string,
  status: 'Broken' | 'Cancelled',
  refresh: () => void,
  setErr: (s: string | null) => void
) {
  if (!window.confirm(`Mark this promise as ${status}?`)) return;
  setErr(null);
  try {
    const r = await fetch(`/api/promises/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then(x => x.json());
    if (!r?.ok) throw new Error(r?.error || 'Failed');
    refresh();
  } catch (e: any) { setErr(e.message); }
}

async function approveLatestHold(
  data: DrawerData,
  refresh: () => void,
  setErr: (s: string | null) => void
) {
  const candidate = data.holds.find(h => h.status === 'Candidate');
  if (!candidate) { setErr('No candidate hold to approve'); return; }
  if (!window.confirm('Approve this hold? Bookings for this account will be blocked.')) return;
  setErr(null);
  try {
    const r = await fetch(`/api/holds/${encodeURIComponent(candidate.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Active' }),
    }).then(x => x.json());
    if (!r?.ok) throw new Error(r?.error || 'Failed');
    refresh();
  } catch (e: any) { setErr(e.message); }
}

async function releaseLatestHold(
  data: DrawerData,
  refresh: () => void,
  setErr: (s: string | null) => void
) {
  const active = data.holds.find(h => h.status === 'Active');
  if (!active) { setErr('No active hold to release'); return; }
  const note = window.prompt('Release reason (optional):') || undefined;
  if (note === undefined && !window.confirm('Release this hold without a note?')) return;
  setErr(null);
  try {
    const r = await fetch(`/api/holds/${encodeURIComponent(active.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Released', note }),
    }).then(x => x.json());
    if (!r?.ok) throw new Error(r?.error || 'Failed');
    refresh();
  } catch (e: any) { setErr(e.message); }
}

// ─── Overview tab ─────────────────────────────────────────────
function OverviewTab({ data }: { data: DrawerData }) {
  const a = data.account;
  const lastHold = data.holds[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Hero — outstanding + tier */}
      <div style={{
        background: 'linear-gradient(135deg, #0b1629 0%, #1a2540 100%)',
        color: '#fff', borderRadius: 12, padding: '20px 22px',
      }}>
        <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Outstanding</div>
        <div style={{ fontSize: 28, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>{fmtINR(Number(a.bill))}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, opacity: .8 }}>
          <TierBadge tier={a.tier} /> · <TierLabel tier={a.tier} /> · {a.exec || 'no exec'}
        </div>
      </div>

      {/* Aging row */}
      <Card title="Aging">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {[
            { l: '≤30d', v: a.d30 }, { l: '≤60d', v: a.d60 },
            { l: '≤90d', v: a.d90 }, { l: '>90d', v: a.d90p },
          ].map(b => (
            <div key={b.l}>
              <div style={{ fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 4 }}>{b.l}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--navy-deep)', fontWeight: 600 }}>{fmtINR(Number(b.v))}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Status row */}
      <Card title="Status">
        <KV label="On Hold"      value={a.onHold || '—'}  pill={a.onHold === 'Active' ? 'rust' : a.onHold === 'Candidate' ? 'amber' : null} />
        <KV label="Alert"        value={a.alert || '—'} />
        <KV label="Stage"        value={a.stage || '—'} />
        <KV label="Next Follow"  value={a.nextFu ? fmtDate(a.nextFu) : '—'} />
        <KV label="Last Touched" value={a.lastTouched ? fmtRelative(a.lastTouched) : '—'} />
        {lastHold && (
          <KV label="Hold Reason" value={lastHold.reason || '—'} />
        )}
      </Card>

      {/* Credit policy */}
      <Card title="Credit policy">
        <KV label="Limit"   value={fmtINR(Number(a.creditLimit || 0))} />
        <KV label="Terms"   value={a.creditPeriod || '—'} />
        <KV label="On-Time" value={a.onTimePct || '—'} />
      </Card>
    </div>
  );
}

// ─── Timeline tab ─────────────────────────────────────────────
function TimelineTab({ data }: { data: DrawerData }) {
  if (data.history.length === 0) {
    return <Empty label="No timeline entries yet" />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.history.map(h => (
        <div key={h.id} style={{
          padding: 14, borderRadius: 10, border: '1px solid var(--line, #e7eaf0)',
          background: 'var(--bg-1, #fff)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontWeight: 600, color: 'var(--navy-deep)', fontSize: 13 }}>{h.action}</div>
            <div style={{ fontSize: 11, color: 'var(--t-3)' }}>{fmtDateTime(h.ts)}</div>
          </div>
          {h.newValue && <div style={{ fontSize: 12, color: 'var(--t-2)' }}>{h.newValue}</div>}
          {h.exec && <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>by {h.exec}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Contact tab ──────────────────────────────────────────────
function ContactTab({ data }: { data: DrawerData }) {
  const c = data.client;
  if (!c) return <Empty label="No client master record" />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card title="Contact details">
        <KV label="Phone"    value={c.phone1 || '—'} />
        <KV label="Phone 2"  value={c.phone2 || '—'} />
        <KV label="WhatsApp" value={c.whatsapp || '—'} />
        <KV label="Email"    value={c.email || '—'} />
      </Card>
      <Card title="Stakeholders">
        <KV label="Owner" value={c.owner || '—'} />
        <KV label="AP"    value={c.ap || '—'} />
        <KV label="Admin" value={c.admin || '—'} />
        <KV label="VIP"   value={c.vip || '—'} pill={c.vip === 'YES' ? 'amber' : null} />
      </Card>
      {c.address && (
        <Card title="Address">
          <div style={{ fontSize: 13, color: 'var(--t-2)', whiteSpace: 'pre-wrap' }}>{c.address}</div>
        </Card>
      )}
    </div>
  );
}

// ─── Promises tab ─────────────────────────────────────────────
function PromisesTab({
  data, onSettleKept, onMarkBroken, onMarkCancelled,
}: {
  data: DrawerData;
  onSettleKept: (id: string) => void;
  onMarkBroken: (id: string) => void;
  onMarkCancelled: (id: string) => void;
}) {
  if (data.promises.length === 0) {
    return <Empty label="No promises logged" />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.promises.map(p => (
        <div key={p.id} style={{
          padding: 14, borderRadius: 10, border: '1px solid var(--line, #e7eaf0)',
          background: 'var(--bg-1, #fff)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--navy-deep)', fontSize: 13 }}>
                {fmtINR(Number(p.outstandingAt))} by {fmtDate(p.expectedBy)}
              </div>
              {p.exec && <div style={{ fontSize: 11, color: 'var(--t-3)' }}>logged by {p.exec}</div>}
            </div>
            <PromisePill status={p.status} />
          </div>
          {p.notes && <div style={{ fontSize: 12, color: 'var(--t-2)', marginTop: 4 }}>{p.notes}</div>}
          {p.settledOn && <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>settled {fmtDate(p.settledOn)} · ₹{Number(p.amountReceived).toLocaleString('en-IN')} received</div>}

          {/* Inline lifecycle actions — Open promises only */}
          {p.status === 'Open' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <InlineBtn color="sage" onClick={() => onSettleKept(p.id)}>Mark Kept</InlineBtn>
              <InlineBtn color="rust" onClick={() => onMarkBroken(p.id)}>Mark Broken</InlineBtn>
              <InlineBtn color="muted" onClick={() => onMarkCancelled(p.id)}>Cancel</InlineBtn>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InlineBtn({
  color, children, onClick,
}: { color: 'sage' | 'rust' | 'muted'; children: React.ReactNode; onClick: () => void }) {
  const map = {
    sage:  { bg: 'rgba(83,127,107,.12)',  fg: 'var(--sage)' },
    rust:  { bg: 'rgba(178,79,55,.12)',   fg: 'var(--rust)' },
    muted: { bg: 'rgba(120,130,150,.12)', fg: 'var(--t-2)' },
  } as const;
  const c = map[color];
  return (
    <button onClick={onClick} style={{
      background: c.bg, color: c.fg, border: 'none', borderRadius: 6,
      padding: '5px 10px', fontSize: 10.5, fontWeight: 700,
      letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer',
    }}>{children}</button>
  );
}

// ─── Tiny shared bits ─────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      border: '1px solid var(--line, #e7eaf0)', borderRadius: 12,
      padding: '14px 16px', background: 'var(--bg-1, #fff)',
    }}>
      <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </section>
  );
}

function KV({ label, value, pill }: { label: string; value: string; pill?: 'rust' | 'amber' | 'sage' | null }) {
  const pillColor = pill === 'rust' ? 'var(--rust)' : pill === 'amber' ? 'var(--amber)' : pill === 'sage' ? 'var(--sage)' : null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: 'var(--t-3)' }}>{label}</span>
      <span style={{ color: pillColor || 'var(--navy-deep)', fontWeight: pill ? 600 : 500 }}>{value}</span>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--t-3)', fontSize: 13 }}>{label}</div>;
}

function PromisePill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    Open:      { bg: 'rgba(217,165,69,.18)',  fg: 'var(--amber)' },
    Kept:      { bg: 'rgba(83,127,107,.18)',  fg: 'var(--sage)' },
    Broken:    { bg: 'rgba(178,79,55,.18)',   fg: 'var(--rust)' },
    Cancelled: { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' },
  };
  const s = map[status] || map.Open;
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700,
      letterSpacing: '.12em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 6,
    }}>{status}</span>
  );
}

// ─── Action button (in the action bar) ────────────────────────
function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--bg-1, #fff)', color: 'var(--navy-deep)',
        border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
        padding: '8px 14px', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        transition: 'background .12s ease',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#eef2f8')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-1, #fff)')}
    >{children}</button>
  );
}

// ─── Generic modal shell ──────────────────────────────────────
function ModalShell({
  title, onClose, children, footer,
}: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  // Close on Esc
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(11,22,41,.55)', zIndex: 200,
      }} />
      <div role="dialog" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(480px, 92vw)', background: 'var(--bg-1, #fff)',
        borderRadius: 14, boxShadow: '0 20px 60px rgba(11,22,41,.35)',
        zIndex: 201, display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'hidden',
      }}>
        <header style={{
          padding: '18px 22px', borderBottom: '1px solid var(--line, #e7eaf0)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--navy-deep)' }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 20, color: 'var(--t-2)', lineHeight: 1,
          }}>×</button>
        </header>
        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>{children}</div>
        <footer style={{
          padding: '14px 22px', borderTop: '1px solid var(--line, #e7eaf0)',
          background: 'var(--bg-2, #f6f8fb)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>{footer}</footer>
      </div>
    </>
  );
}

// ─── Log Call modal ───────────────────────────────────────────
const CALL_OUTCOMES = [
  'Spoke to AP',
  'Spoke to Owner',
  'Voicemail / no answer',
  'Payment confirmed',
  'Promise received',
  'Escalation note sent',
  'WhatsApp sent',
  'Email sent',
  'Other',
];

function LogCallModal({
  party, currentStatus, currentNextFu, onClose, onSaved,
}: {
  party: string;
  currentStatus: string | null;
  currentNextFu: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [note, setNote] = useState('');
  const [nextFu, setNextFu] = useState(currentNextFu ? currentNextFu.slice(0, 10) : '');
  const [status, setStatus] = useState(currentStatus || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch('/api/log-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party, outcome, note: note || undefined,
          nextFu: nextFu || undefined, status: status || undefined,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to log call');
      onSaved();
    } catch (e: any) {
      setErr(e.message); setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Log call"
      onClose={onClose}
      footer={
        <>
          <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
          <BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary>
        </>
      }
    >
      <Field label="Outcome">
        <select value={outcome} onChange={e => setOutcome(e.target.value)} style={inputStyle}>
          {CALL_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Note (optional)">
        <textarea
          value={note} onChange={e => setNote(e.target.value)}
          placeholder="What was discussed, what was committed…"
          rows={3} style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Next follow-up">
          <input type="date" value={nextFu} onChange={e => setNextFu(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="New status (optional)">
          <input type="text" value={status} onChange={e => setStatus(e.target.value)} placeholder="Pending / Resolved" style={inputStyle} />
        </Field>
      </div>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Add Promise modal ────────────────────────────────────────
function AddPromiseModal({
  party, currentOutstanding, onClose, onSaved,
}: {
  party: string;
  currentOutstanding: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Default expectedBy = today + 7 days
  const defaultDate = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const [expectedBy, setExpectedBy] = useState(defaultDate);
  const [outstandingAt, setOutstandingAt] = useState(String(currentOutstanding));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch('/api/promises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party, expectedBy,
          outstandingAt: Number(outstandingAt),
          note: note || undefined,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to add promise');
      onSaved();
    } catch (e: any) {
      setErr(e.message); setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Add promise"
      onClose={onClose}
      footer={
        <>
          <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
          <BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Expected by">
          <input type="date" value={expectedBy} onChange={e => setExpectedBy(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Amount promised (₹)">
          <input
            type="number" min="0" step="1"
            value={outstandingAt} onChange={e => setOutstandingAt(e.target.value)}
            style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
          />
        </Field>
      </div>
      <Field label="Note (optional)">
        <textarea
          value={note} onChange={e => setNote(e.target.value)}
          placeholder="Who promised, how, any conditions"
          rows={3} style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Form bits shared by modals ───────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{
        fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
        color: 'var(--t-3)', fontWeight: 700, marginBottom: 6,
      }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '10px 12px',
  border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
  outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit',
  background: 'var(--bg-1, #fff)',
};

function BtnPrimary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: 'var(--navy-deep)', color: '#fff',
      border: 'none', borderRadius: 8, padding: '9px 18px',
      fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}>{children}</button>
  );
}

function BtnSecondary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: 'transparent', color: 'var(--t-2)',
      border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, padding: '9px 18px',
      fontSize: 13, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
  );
}

// ─── Settle Promise modal (Mark Kept with amount received) ────
function SettlePromiseModal({
  promise, onClose, onSaved,
}: {
  promise: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(promise.outstandingAt || 0));
  const [settledOn, setSettledOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/promises/${encodeURIComponent(promise.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Kept',
          amountReceived: Number(amount),
          settledOn,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to settle');
      onSaved();
    } catch (e: any) {
      setErr(e.message); setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Mark promise kept"
      onClose={onClose}
      footer={
        <>
          <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
          <BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Confirm settled'}</BtnPrimary>
        </>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 12 }}>
        Promised: <strong style={{ color: 'var(--navy-deep)' }}>{fmtINR(Number(promise.outstandingAt))}</strong> by {fmtDate(promise.expectedBy)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Amount received (₹)">
          <input
            type="number" min="0" step="1"
            value={amount} onChange={e => setAmount(e.target.value)}
            style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
          />
        </Field>
        <Field label="Settled on">
          <input type="date" value={settledOn} onChange={e => setSettledOn(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Flag Hold modal ──────────────────────────────────────────
function FlagHoldModal({
  party, currentOutstanding, onClose, onSaved,
}: {
  party: string;
  currentOutstanding: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<'Candidate' | 'Active'>('Candidate');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (reason.trim().length < 3) { setErr('Reason is required (3+ chars)'); return; }
    setSaving(true); setErr(null);
    try {
      const r = await fetch('/api/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party, reason, status }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to flag hold');
      onSaved();
    } catch (e: any) {
      setErr(e.message); setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Flag hold"
      onClose={onClose}
      footer={
        <>
          <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
          <BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : status === 'Active' ? 'Activate hold' : 'Flag as candidate'}</BtnPrimary>
        </>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 12 }}>
        Outstanding: <strong style={{ color: 'var(--navy-deep)' }}>{fmtINR(currentOutstanding)}</strong>
      </div>
      <Field label="Reason">
        <textarea
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Why is this account being held? (visible to booking team)"
          rows={3} style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>
      <Field label="Status">
        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="radio" checked={status === 'Candidate'} onChange={() => setStatus('Candidate')} />
            Candidate <span style={{ color: 'var(--t-3)', fontSize: 11 }}>(awaiting approval)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="radio" checked={status === 'Active'} onChange={() => setStatus('Active')} />
            Active <span style={{ color: 'var(--t-3)', fontSize: 11 }}>(blocks bookings)</span>
          </label>
        </div>
      </Field>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}
