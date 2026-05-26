// ============================================================
// AccountDrawer — slide-in panel showing one account's full record.
// ============================================================
// Mirrors the old Apps Script portal layout:
//
//   ▸ Header: party name (h2), clickable TIER badge top-right with
//             dropdown to change tier, close ×.
//             Subtitle: FAMILY · Exec NAME · CM NAME
//             Status pills (PENDING / CANDIDATE / ACTIVE / DUE SOON).
//
//   ▸ Tabs: ACCOUNT | TIMELINE | CONTACT
//
//   ▸ ACCOUNT tab (top → bottom):
//       1. Context section with colored LEFT BORDER (only if applicable)
//            • Legal (tier E):   red border   "LEGAL CASE · STATUS"
//            • Doubtful (tier D): yellow border "DOUBTFUL PLAN"
//            • Promises ledger: blue border  "PROMISE HISTORY (n)"
//       2. OUTSTANDING amount + NEXT ACTION
//       3. Aging buckets (≤30d / ≤60d / ≤90d / >90d)
//       4. 4 round action buttons: LOG CALL · PAID · ON HOLD · CREDIT
//       5. Add phone / Add WhatsApp (two columns)
//       6. ESCALATION fields: Stage / Recent Call / Call Outcome /
//                              Next Follow-up / Pay Expected
//       7. HISTORY (freeform text, editable)
//
//   ▸ TIMELINE tab: AccountHistory rows, newest first.
//   ▸ CONTACT tab:   ClientMaster contact info.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { fmtINR, fmtDate, fmtDateTime, fmtRelative } from '../lib/fmt';

type Tab = 'account' | 'timeline' | 'contact';
type ModalKind =
  | null
  | 'log-call'
  | 'add-promise'
  | 'settle-promise'
  | 'flag-hold'
  | 'mark-paid'
  | 'credit'
  | 'edit-contact'
  | 'edit-history'
  | 'edit-legal'
  | 'edit-doubtful';

type DrawerData = {
  account: any;
  client: any | null;
  promises: any[];
  holds: any[];
  history: any[];
  paymentPlan: any | null;
  instalments: any[];
  legalCase: any | null;
};

type Props = {
  accountId: string | null;
  onClose: () => void;
};

const TIER_LABEL: Record<string, string> = {
  A: 'A — Recents', B: 'B — Due', C: 'C — Overdue', D: 'D — Doubtful', E: 'E — Legal',
};

export function AccountDrawer({ accountId, onClose }: Props) {
  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('account');
  const [modal, setModal] = useState<ModalKind>(null);
  const [settlePromiseId, setSettlePromiseId] = useState<string | null>(null);
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

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

  useEffect(() => {
    if (!accountId) { setData(null); setError(null); return; }
    setTab('account');
    setModal(null);
    setTierMenuOpen(false);
    setActionErr(null);
    loadData(accountId);
  }, [accountId, loadData]);

  const refresh = useCallback(() => {
    if (accountId) loadData(accountId);
  }, [accountId, loadData]);

  // Esc to close
  useEffect(() => {
    if (!accountId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accountId, onClose]);

  async function changeTier(newTier: string) {
    if (!accountId) return;
    setTierMenuOpen(false);
    if (!data?.account || data.account.tier === newTier) return;
    setActionErr(null);
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: newTier }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to change tier');
      refresh();
    } catch (e: any) { setActionErr(e.message); }
  }

  if (!accountId) return null;
  const a = data?.account;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(8, 24, 58, 0.55)',
        backdropFilter: 'blur(3px)', zIndex: 100,
      }} />

      <aside role="dialog" aria-label="Account details" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(680px, 94vw)',
        background: 'var(--bg-1, #FBF6E8)',
        boxShadow: '-30px 0 60px rgba(8,24,58,.22)',
        zIndex: 101, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <header style={{
          padding: '20px 26px 14px',
          borderBottom: '1px solid var(--line, #e7eaf0)',
          background: '#fff',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <h2 style={{
              margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--navy-deep)',
              letterSpacing: '.01em', lineHeight: 1.25, flex: 1, wordBreak: 'break-word',
            }}>
              {a?.party || (loading ? 'Loading…' : '—')}
            </h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {a && <TierDropdown tier={a.tier} open={tierMenuOpen} onToggle={() => setTierMenuOpen(o => !o)} onPick={changeTier} />}
              <button onClick={onClose} aria-label="Close" style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 22, color: 'var(--t-3)', lineHeight: 1, padding: 4,
              }}>×</button>
            </div>
          </div>
          {a && (
            <div style={{ fontSize: 11.5, color: 'var(--t-3)', marginTop: 6, fontWeight: 500, letterSpacing: '.01em' }}>
              {a.family || '—'}
              {' · '}
              <span>Exec <strong style={{ color: 'var(--t-2)' }}>{a.exec || '—'}</strong></span>
              {a.cm && <>{' · '}<span>CM <strong style={{ color: 'var(--t-2)' }}>{a.cm}</strong></span></>}
            </div>
          )}
          {a && <StatusPillRow account={a} />}
        </header>

        {/* Tabs */}
        <nav style={{
          display: 'flex', borderBottom: '1px solid var(--line, #e7eaf0)',
          padding: '0 18px', background: '#fff',
        }}>
          {(['account','timeline','contact'] as const).map(t => {
            const active = tab === t;
            const label = t === 'account' ? 'Account' : t === 'timeline' ? 'Timeline' : 'Contact';
            return (
              <button key={t} onClick={() => setTab(t)} style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                padding: '14px 18px', fontSize: 11, fontWeight: 700,
                letterSpacing: '.22em', textTransform: 'uppercase',
                color: active ? 'var(--navy-deep)' : 'var(--t-3)',
                borderBottom: active ? '2px solid var(--navy-deep)' : '2px solid transparent',
                marginBottom: -1,
              }}>{label}</button>
            );
          })}
        </nav>

        {actionErr && (
          <div style={{
            padding: '8px 26px', background: 'rgba(178,79,55,.10)',
            color: 'var(--rust)', fontSize: 12, borderBottom: '1px solid var(--line, #e7eaf0)',
          }}>{actionErr}</div>
        )}

        {/* Body */}
        <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: 22, background: 'var(--paper, #F4F6FA)' }}>
          {loading && <div style={{ color: 'var(--t-3)', padding: 16 }}>Loading…</div>}
          {error && <div style={{ color: 'var(--rust)', padding: 16 }}>Failed: {error}</div>}
          {data && tab === 'account' && (
            <AccountTab
              data={data}
              onAction={(k) => setModal(k)}
              onSettlePromise={(id) => { setSettlePromiseId(id); setModal('settle-promise'); }}
              refresh={refresh}
              setErr={setActionErr}
            />
          )}
          {data && tab === 'timeline' && <TimelineTab data={data} />}
          {data && tab === 'contact' && <ContactTab data={data} onAction={(k) => setModal(k)} />}
        </div>
      </aside>

      {/* Modals */}
      {modal === 'log-call' && a && (
        <LogCallModal party={a.party} currentStatus={a.status} currentNextFu={a.nextFu}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'add-promise' && a && (
        <AddPromiseModal party={a.party} currentOutstanding={Number(a.bill || 0)}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'settle-promise' && settlePromiseId && data && (
        <SettlePromiseModal promise={data.promises.find(p => p.id === settlePromiseId)!}
          onClose={() => { setModal(null); setSettlePromiseId(null); }}
          onSaved={() => { setModal(null); setSettlePromiseId(null); refresh(); }} />
      )}
      {modal === 'flag-hold' && a && (
        <FlagHoldModal party={a.party} currentOutstanding={Number(a.bill || 0)}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'credit' && a && accountId && (
        <CreditModal accountId={accountId} account={a}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'edit-history' && a && accountId && (
        <HistoryModal accountId={accountId} initial={a.history || ''}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'edit-legal' && data?.legalCase && (
        <LegalEditModal legal={data.legalCase}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'edit-doubtful' && data?.paymentPlan && (
        <DoubtfulEditModal plan={data.paymentPlan} instalments={data.instalments}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'edit-contact' && a && (
        <ContactEditModal party={a.party} family={a.family} client={data?.client}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }} />
      )}
    </>
  );
}

// ─── Tier dropdown ───────────────────────────────────────────
function TierDropdown({ tier, open, onToggle, onPick }: {
  tier: string; open: boolean; onToggle: () => void; onPick: (t: string) => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={onToggle} className={`tier tier-${tier}`} style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', fontSize: 13, fontWeight: 700,
        cursor: 'pointer', border: 'none',
      }}>
        {tier}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={open ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: '#fff', border: '1px solid var(--line, #e7eaf0)',
          borderRadius: 8, boxShadow: '0 10px 30px rgba(8,24,58,.18)',
          minWidth: 180, padding: 6, zIndex: 110,
        }}>
          {(['A','B','C','D','E'] as const).map(t => (
            <button key={t} onClick={() => onPick(t)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '8px 10px', fontSize: 13, color: 'var(--t-1)',
              borderRadius: 6, fontWeight: tier === t ? 700 : 500,
              textAlign: 'left',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {TIER_LABEL[t]}
              {tier === t && <span style={{ color: 'var(--sage)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Status pill row (top of header) ─────────────────────────
function StatusPillRow({ account }: { account: any }) {
  const pills: Array<{ label: string; tone: 'amber' | 'rust' | 'sage' | 'muted' }> = [];
  if (account.status) {
    pills.push({ label: account.status, tone: account.status === 'Legal' ? 'rust' : account.status === 'Doubtful' ? 'amber' : 'muted' });
  }
  if (account.onHold === 'Candidate') pills.push({ label: 'Candidate', tone: 'amber' });
  if (account.onHold === 'Active')    pills.push({ label: 'On Hold',   tone: 'rust' });
  if (account.alert)                  pills.push({ label: account.alert, tone: account.alert === 'On Hold' ? 'rust' : account.alert === 'Escalate' ? 'rust' : 'amber' });
  if (pills.length === 0) return null;

  const colorMap = {
    amber: { bg: 'rgba(176,127,28,.15)', fg: 'var(--amber)' },
    rust:  { bg: 'rgba(181,72,61,.15)',  fg: 'var(--rust)' },
    sage:  { bg: 'rgba(46,125,92,.15)',  fg: 'var(--sage)' },
    muted: { bg: 'rgba(100,116,139,.15)',fg: 'var(--t-2)' },
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {pills.map((p, i) => {
        const c = colorMap[p.tone];
        return (
          <span key={i} style={{
            background: c.bg, color: c.fg, fontSize: 10, fontWeight: 700,
            letterSpacing: '.14em', textTransform: 'uppercase',
            padding: '4px 9px', borderRadius: 5,
          }}>{p.label}</span>
        );
      })}
    </div>
  );
}

// ─── Account tab ─────────────────────────────────────────────
function AccountTab({
  data, onAction, onSettlePromise, refresh, setErr,
}: {
  data: DrawerData;
  onAction: (k: ModalKind) => void;
  onSettlePromise: (id: string) => void;
  refresh: () => void;
  setErr: (s: string | null) => void;
}) {
  const a = data.account;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Context section — colored left border depending on tier */}
      {a.tier === 'E' && data.legalCase && (
        <ContextCard
          tone="rust"
          title={`Legal case · ${data.legalCase.status}`}
          action={
            <button onClick={() => onAction('edit-legal')} aria-label="Edit legal case" style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--rust)', padding: 4, display: 'flex',
            }}><PencilIcon /></button>
          }
        >
          <LegalCaseDetails legal={data.legalCase} />
        </ContextCard>
      )}
      {a.tier === 'D' && data.paymentPlan && (
        <ContextCard
          tone="amber"
          title="Doubtful plan"
          action={
            <button onClick={() => onAction('edit-doubtful')} aria-label="Edit doubtful plan" style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--amber)', padding: 4, display: 'flex',
            }}><PencilIcon /></button>
          }
        >
          <PaymentPlanDetails plan={data.paymentPlan} instalments={data.instalments} />
        </ContextCard>
      )}

      {/*
        Promises card visibility rules:
          • Tier D (Doubtful)  → never shown (promise events visible in Timeline).
          • Tier E (Legal)     → never shown (promise events visible in Timeline).
          • Tier A / B / C     → only when at least one promise exists. First
                                  promise gets created via Log Call's "Promise
                                  to pay by" field; the + button in this card
                                  header is for adding subsequent promises.
      */}
      {a.tier !== 'D' && a.tier !== 'E' && data.promises.length > 0 && (
        <ContextCard
          tone="navy"
          title={`Promises (${data.promises.length})`}
          action={
            <button onClick={() => onAction('add-promise')} aria-label="Add promise" style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--navy)', padding: 4, display: 'flex',
            }}><PlusIcon /></button>
          }
        >
          <PromiseHistoryDetails promises={data.promises}
            onSettleKept={onSettlePromise}
            onMarkBroken={(id) => quickSettle(id, 'Broken', refresh, setErr)}
            onMarkCancelled={(id) => quickSettle(id, 'Cancelled', refresh, setErr)}
          />
        </ContextCard>
      )}

      {/* OUTSTANDING + NEXT ACTION + AGING — single combined card */}
      <div style={{
        background: '#fff', border: '1px solid var(--line, #e7eaf0)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        {/* Top half: Outstanding + Next Action */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
          padding: '18px 20px',
        }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>Outstanding</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 700, color: 'var(--navy-deep)', lineHeight: 1 }}>
              {fmtINR(Number(a.bill || 0))}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t-3)', marginTop: 6 }}>Across {a.exec || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>Next action</div>
            <NextActionLine account={a} />
          </div>
        </div>

        {/* Bottom half: Aging buckets (with top divider) */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0,
          padding: '14px 20px',
          borderTop: '1px solid var(--line, #e7eaf0)',
          background: 'var(--bg-2, #fafbfd)',
        }}>
          {[
            { label: '≤ 30 d', value: a.d30 },
            { label: '≤ 60 d', value: a.d60 },
            { label: '≤ 90 d', value: a.d90 },
            { label: '> 90 d', value: a.d90p },
          ].map((b, i) => (
            <div key={b.label} style={{
              paddingLeft: i === 0 ? 0 : 14,
              borderLeft: i === 0 ? 'none' : '1px solid var(--line, #e7eaf0)',
            }}>
              <div style={{ fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{b.label}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: Number(b.value) === 0 ? 'var(--t-3)' : 'var(--navy-deep)' }}>{fmtINR(Number(b.value || 0))}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 4 round action buttons */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
        padding: '18px 18px', background: '#fff',
        border: '1px solid var(--line, #e7eaf0)', borderRadius: 12,
      }}>
        <RoundAction icon={<PhoneIcon />}    label="Log Call" onClick={() => onAction('log-call')} />
        <RoundAction icon={<CheckIcon />}    label="Paid"     onClick={() => onAction('mark-paid')} />
        <RoundAction icon={<HoldIcon />}     label="On Hold"  onClick={() => onAction('flag-hold')} active={!!a.onHold} />
        <RoundAction icon={<CardIcon />}     label="Credit"   onClick={() => onAction('credit')} />
      </div>

      {/* Add phone | Add WhatsApp */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <ContactQuickBtn icon={<PhoneSmIcon />} label={data.client?.phone1 ? `Call ${data.client.phone1}` : 'Add phone'}
          onClick={() => {
            if (data.client?.phone1) window.location.href = `tel:${data.client.phone1}`;
            else onAction('edit-contact');
          }} />
        <ContactQuickBtn icon={<ChatIcon />} label={data.client?.whatsapp ? 'Open WhatsApp' : 'Add WhatsApp'}
          onClick={() => {
            if (data.client?.whatsapp) window.open(`https://wa.me/${data.client.whatsapp.replace(/\D/g,'')}`, '_blank');
            else onAction('edit-contact');
          }} />
      </div>

      {/* ESCALATION */}
      <Section title="Escalation">
        <KV label="Stage" value={a.stage || '—'} />
        <KV label="Recent call" value={a.recentCall ? `${fmtDate(a.recentCall)} (${fmtRelative(a.recentCall)})` : '—'} />
        <KV label="Call outcome" value={a.callOutcome || '—'} />
        <KV
          label="Next follow-up"
          value={a.nextFu ? fmtDate(a.nextFu) : '—'}
          pill={a.nextFu && new Date(a.nextFu) < new Date() ? { label: 'OVERDUE', tone: 'rust' } : null}
        />
        <KV
          label="Pay expected"
          value={a.payExpected ? fmtDate(a.payExpected) : '—'}
          pill={a.payExpected && new Date(a.payExpected) < new Date() ? { label: 'OVERDUE', tone: 'rust' } : null}
        />
      </Section>

      {/* HISTORY (freeform) */}
      <Section
        title="History"
        action={<button onClick={() => onAction('edit-history')} aria-label="Edit history" style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--t-3)', padding: 4,
        }}><PencilIcon /></button>}
      >
        {a.history ? (
          <pre style={{
            margin: 0, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55,
            color: 'var(--t-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{a.history}</pre>
        ) : (
          <div style={{ color: 'var(--t-3)', fontSize: 13, fontStyle: 'italic' }}>No history yet.</div>
        )}
      </Section>
    </div>
  );
}

// ─── Context card (Legal / Doubtful / Promise) ───────────────
function ContextCard({ tone, title, action, children }: {
  tone: 'rust' | 'amber' | 'navy';
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const colorMap = {
    rust:  'var(--rust)',
    amber: 'var(--amber)',
    navy:  'var(--navy)',
  };
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--line, #e7eaf0)',
      borderLeft: `4px solid ${colorMap[tone]}`,
      borderRadius: 10, padding: '16px 18px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12,
      }}>
        <div style={{
          fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase',
          color: colorMap[tone], fontWeight: 700,
        }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function LegalCaseDetails({ legal }: { legal: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <KV label="Status" value={legal.status} />
      {legal.lawyer && <KV label="Lawyer" value={legal.lawyer} />}
      {legal.caseRef && <KV label="Reference" value={legal.caseRef} />}
      {legal.nextHearing && <KV label="Next hearing" value={fmtDate(legal.nextHearing)} />}
      {legal.notes && (
        <div>
          <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 4 }}>Notes</div>
          <div style={{ fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>{legal.notes}</div>
        </div>
      )}
    </div>
  );
}

function PaymentPlanDetails({ plan, instalments }: { plan: any; instalments: any[] }) {
  const received = instalments.reduce((n, i) => n + Number(i.received || 0), 0);
  const total = Number(plan.planTotal);
  const remaining = total - received;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <KvBlock label="Plan total" value={fmtINR(total)} />
        <KvBlock label="Received so far" value={fmtINR(received)} color="sage" />
        <KvBlock label="Remaining" value={fmtINR(remaining)} color={remaining > 0 ? 'rust' : 'sage'} />
      </div>
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 8 }}>Instalment schedule</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {instalments.map(i => (
            <div key={i.id} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px',
              gap: 12, alignItems: 'center', fontSize: 12,
              padding: '6px 0', borderBottom: '1px dashed var(--line, #e7eaf0)',
            }}>
              <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{i.instNo}/{instalments.length}</div>
              <div style={{ color: 'var(--t-3)' }}>due {fmtDate(i.dueDate)}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", textAlign: 'right' }}>{fmtINR(Number(i.amount))}</div>
              <div style={{ textAlign: 'right' }}><MiniPill status={i.status} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PromiseHistoryDetails({
  promises, onSettleKept, onMarkBroken, onMarkCancelled,
}: {
  promises: any[];
  onSettleKept: (id: string) => void;
  onMarkBroken: (id: string) => void;
  onMarkCancelled: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {promises.slice(0, 6).map(p => (
        <div key={p.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-deep)' }}>
                Expected {fmtDate(p.expectedBy)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t-3)' }}>
                logged {fmtDate(p.loggedAt)}{p.exec ? ` · ${p.exec}` : ''}
              </div>
            </div>
            <MiniPill status={p.status} />
          </div>
          {p.notes && <div style={{ fontSize: 12, color: 'var(--t-2)', marginTop: 2 }}>{p.notes}</div>}
          {p.status === 'Open' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <InlineBtn color="sage"  onClick={() => onSettleKept(p.id)}>Mark Kept</InlineBtn>
              <InlineBtn color="rust"  onClick={() => onMarkBroken(p.id)}>Mark Broken</InlineBtn>
              <InlineBtn color="muted" onClick={() => onMarkCancelled(p.id)}>Cancel</InlineBtn>
            </div>
          )}
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--t-3)', fontStyle: 'italic', borderTop: '1px dashed var(--line, #e7eaf0)', paddingTop: 8 }}>
        Use "Log Call" above to add a new promise. Set status here as the outcome comes in.
      </div>
    </div>
  );
}

// ─── Round action button ─────────────────────────────────────
function RoundAction({ icon, label, onClick, active }: {
  icon: React.ReactNode; label: string; onClick: () => void; active?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      background: 'transparent', border: 'none', cursor: 'pointer',
      padding: '4px 0',
    }}>
      <span style={{
        width: 48, height: 48, borderRadius: '50%',
        background: active ? 'var(--rust)' : 'var(--navy-deep)',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform .12s ease, background .12s ease',
      }}>{icon}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.18em',
        textTransform: 'uppercase', color: 'var(--t-2)',
      }}>{label}</span>
    </button>
  );
}

function ContactQuickBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      background: '#fff', border: '1px solid var(--line, #e7eaf0)',
      borderRadius: 10, padding: '12px 14px',
      fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--t-2)',
    }}
    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
      {icon}{label}
    </button>
  );
}

// ─── Section wrapper ─────────────────────────────────────────
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{
      background: '#fff', border: '1px solid var(--line, #e7eaf0)',
      borderRadius: 12, padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{title}</div>
        {action}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  );
}

function KV({ label, value, pill }: { label: string; value: string; pill?: { label: string; tone: 'rust' | 'amber' | 'sage' } | null }) {
  const pillColor = pill ? (pill.tone === 'rust' ? 'var(--rust)' : pill.tone === 'amber' ? 'var(--amber)' : 'var(--sage)') : null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: 'var(--t-3)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--navy-deep)' }}>{value}</span>
        {pill && pillColor && (
          <span style={{
            background: `${pillColor}1a`, color: pillColor,
            fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: 4,
          }}>{pill.label}</span>
        )}
      </span>
    </div>
  );
}

function KvBlock({ label, value, color }: { label: string; value: string; color?: 'rust' | 'sage' }) {
  const c = color === 'rust' ? 'var(--rust)' : color === 'sage' ? 'var(--sage)' : 'var(--navy-deep)';
  return (
    <div>
      <div style={{ fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: c }}>{value}</div>
    </div>
  );
}

function MiniPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    Open:      { bg: 'rgba(176,127,28,.15)', fg: 'var(--amber)' },
    Kept:      { bg: 'rgba(46,125,92,.15)',  fg: 'var(--sage)' },
    Broken:    { bg: 'rgba(181,72,61,.15)',  fg: 'var(--rust)' },
    Cancelled: { bg: 'rgba(100,116,139,.15)',fg: 'var(--t-2)' },
    Pending:   { bg: 'rgba(176,127,28,.15)', fg: 'var(--amber)' },
    Received:  { bg: 'rgba(46,125,92,.15)',  fg: 'var(--sage)' },
  };
  const s = map[status] || map.Pending;
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 9.5, fontWeight: 700,
      letterSpacing: '.14em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap',
    }}>{status}</span>
  );
}

function InlineBtn({ color, children, onClick }: { color: 'sage' | 'rust' | 'muted'; children: React.ReactNode; onClick: () => void }) {
  const map = {
    sage:  { bg: 'rgba(46,125,92,.12)',  fg: 'var(--sage)' },
    rust:  { bg: 'rgba(181,72,61,.12)',  fg: 'var(--rust)' },
    muted: { bg: 'rgba(100,116,139,.12)',fg: 'var(--t-2)' },
  } as const;
  const c = map[color];
  return (
    <button onClick={onClick} style={{
      background: c.bg, color: c.fg, border: 'none', borderRadius: 5,
      padding: '4px 9px', fontSize: 10, fontWeight: 700,
      letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer',
    }}>{children}</button>
  );
}

function NextActionLine({ account }: { account: any }) {
  const a = account;
  if (a.nextFu && new Date(a.nextFu) < new Date()) {
    return (
      <div>
        <div style={{ fontSize: 14, color: 'var(--rust)', fontWeight: 600 }}>Follow-up overdue ({fmtDate(a.nextFu)})</div>
        <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>
          {a.recentCall ? `Last call · ${fmtDate(a.recentCall)}` : 'No calls yet'}
        </div>
      </div>
    );
  }
  if (a.nextFu) {
    return (
      <div>
        <div style={{ fontSize: 14, color: 'var(--navy-deep)', fontWeight: 600 }}>Follow-up by {fmtDate(a.nextFu)}</div>
        <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>
          {a.recentCall ? `Last call · ${fmtDate(a.recentCall)}` : 'No calls yet'}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--t-2)', fontWeight: 600 }}>No calls yet — make first contact</div>
    </div>
  );
}

// ─── Timeline tab ────────────────────────────────────────────
function TimelineTab({ data }: { data: DrawerData }) {
  if (data.history.length === 0) {
    return <Empty label="No timeline entries yet" />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.history.map(h => (
        <div key={h.id} style={{
          padding: 14, borderRadius: 10, border: '1px solid var(--line, #e7eaf0)',
          background: '#fff',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontWeight: 600, color: 'var(--navy-deep)', fontSize: 13 }}>{h.action}</div>
            <div style={{ fontSize: 11, color: 'var(--t-3)' }}>{fmtDateTime(h.ts)}</div>
          </div>
          {h.oldValue && h.newValue && (
            <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
              <span style={{ textDecoration: 'line-through' }}>{h.oldValue}</span>
              {' → '}
              <span style={{ color: 'var(--t-2)', fontWeight: 600 }}>{h.newValue}</span>
            </div>
          )}
          {h.newValue && !h.oldValue && <div style={{ fontSize: 12, color: 'var(--t-2)' }}>{h.newValue}</div>}
          {h.exec && <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>by {h.exec}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Contact tab ─────────────────────────────────────────────
function ContactTab({ data, onAction }: { data: DrawerData; onAction: (k: ModalKind) => void }) {
  const c = data.client;
  if (!c) {
    return (
      <div style={{ padding: 16 }}>
        <Empty label="No client master record" />
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section title="Contact details" action={
        <button onClick={() => onAction('edit-contact')} style={{ background:'transparent', border:'none', cursor:'pointer', color:'var(--t-3)', padding:4 }} aria-label="Edit"><PencilIcon /></button>
      }>
        <KV label="Phone"    value={c.phone1 || '—'} />
        <KV label="Phone 2"  value={c.phone2 || '—'} />
        <KV label="WhatsApp" value={c.whatsapp || '—'} />
        <KV label="Email"    value={c.email || '—'} />
      </Section>
      <Section title="Stakeholders">
        <KV label="Owner" value={c.owner || '—'} />
        <KV label="AP"    value={c.ap || '—'} />
        <KV label="Admin" value={c.admin || '—'} />
        <KV label="VIP"   value={c.vip || '—'} pill={c.vip === 'YES' ? { label: 'VIP', tone: 'amber' } : null} />
      </Section>
      {c.address && (
        <Section title="Address">
          <div style={{ fontSize: 13, color: 'var(--t-2)', whiteSpace: 'pre-wrap' }}>{c.address}</div>
        </Section>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--t-3)', fontSize: 13 }}>{label}</div>;
}

// ─── Module helpers (used by inline buttons / hold actions) ──
async function quickSettle(id: string, status: 'Broken' | 'Cancelled', refresh: () => void, setErr: (s: string | null) => void) {
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

// ─── Icons ───────────────────────────────────────────────────
function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function HoldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}
function CardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <line x1="2" y1="11" x2="22" y2="11" />
    </svg>
  );
}
function PhoneSmIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ─── Generic modal shell ─────────────────────────────────────
function ModalShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,24,58,.55)', zIndex: 200 }} />
      <div role="dialog" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(480px, 92vw)', background: '#fff',
        borderRadius: 14, boxShadow: '0 30px 80px rgba(8,24,58,.35)',
        zIndex: 201, display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'hidden',
      }}>
        <header style={{
          padding: '18px 22px', borderBottom: '1px solid var(--line, #e7eaf0)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--navy-deep)' }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--t-2)', lineHeight: 1 }}>×</button>
        </header>
        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>{children}</div>
        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--line, #e7eaf0)', background: 'var(--bg-2, #f6f8fb)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</footer>
      </div>
    </>
  );
}

// ─── Log Call modal (matches old portal layout) ──────────────
const CALL_OUTCOMES = [
  'Spoke to AP — no commitment',
  'Spoke to AP — promise received',
  'Spoke to Owner',
  'Voicemail / no answer',
  'Payment confirmed',
  'Escalation note sent',
  'WhatsApp sent',
  'Email sent',
  'Other',
];

function LogCallModal({ party, currentStatus, currentNextFu, onClose, onSaved }: {
  party: string; currentStatus: string | null; currentNextFu: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [status, setStatus] = useState(currentStatus || 'Pending');
  const [nextFu, setNextFu] = useState(currentNextFu ? currentNextFu.slice(0, 10) : '');
  const [promiseBy, setPromiseBy] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch('/api/log-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party, outcome, status, note: note || undefined,
          nextFu: nextFu || undefined,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to log call');

      // If user entered a promise-by date, also create a promise
      if (promiseBy) {
        await fetch('/api/promises', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ party, expectedBy: promiseBy, outstandingAt: 0, note: note || undefined }),
        });
      }
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }

  return (
    <ModalShell title={`Log a Call · ${party}`} onClose={onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Log Call'}</BtnPrimary>
      </>}>
      <Field label="Outcome">
        <select value={outcome} onChange={e => setOutcome(e.target.value)} style={inputStyle}>
          {CALL_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
            <option>Pending</option>
            <option>Resolved</option>
            <option>Doubtful</option>
            <option>Legal</option>
          </select>
        </Field>
        <Field label="Next follow-up">
          <input type="date" value={nextFu} onChange={e => setNextFu(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Promise to pay by (optional)">
        <input type="date" value={promiseBy} onChange={e => setPromiseBy(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Note">
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="What did they say?"
          rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      </Field>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Add Promise modal ───────────────────────────────────────
function AddPromiseModal({ party, currentOutstanding, onClose, onSaved }: { party: string; currentOutstanding: number; onClose: () => void; onSaved: () => void }) {
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
        body: JSON.stringify({ party, expectedBy, outstandingAt: Number(outstandingAt), note: note || undefined }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to add promise');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }
  return (
    <ModalShell title="Add promise" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Expected by"><input type="date" value={expectedBy} onChange={e => setExpectedBy(e.target.value)} style={inputStyle} /></Field>
        <Field label="Amount (₹)"><input type="number" min="0" step="1" value={outstandingAt} onChange={e => setOutstandingAt(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} /></Field>
      </div>
      <Field label="Note (optional)"><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Who promised, how, any conditions" rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Settle Promise modal ────────────────────────────────────
function SettlePromiseModal({ promise, onClose, onSaved }: { promise: any; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(promise.outstandingAt || 0));
  const [settledOn, setSettledOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/promises/${encodeURIComponent(promise.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Kept', amountReceived: Number(amount), settledOn }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to settle');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }
  return (
    <ModalShell title="Mark promise kept" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Confirm settled'}</BtnPrimary></>}>
      <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 12 }}>
        Promised: <strong style={{ color: 'var(--navy-deep)' }}>{fmtINR(Number(promise.outstandingAt))}</strong> by {fmtDate(promise.expectedBy)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Amount received (₹)"><input type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} /></Field>
        <Field label="Settled on"><input type="date" value={settledOn} onChange={e => setSettledOn(e.target.value)} style={inputStyle} /></Field>
      </div>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Flag Hold modal ─────────────────────────────────────────
function FlagHoldModal({ party, currentOutstanding, onClose, onSaved }: { party: string; currentOutstanding: number; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<'Candidate' | 'Active'>('Candidate');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (reason.trim().length < 3) { setErr('Reason is required (3+ chars)'); return; }
    setSaving(true); setErr(null);
    try {
      const r = await fetch('/api/holds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party, reason, status }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to flag hold');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }
  return (
    <ModalShell title="Place account on hold" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : status === 'Active' ? 'Activate hold' : 'Flag as candidate'}</BtnPrimary></>}>
      <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 12 }}>
        Outstanding: <strong style={{ color: 'var(--navy-deep)' }}>{fmtINR(currentOutstanding)}</strong>
      </div>
      <Field label="Reason"><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this account being held? (visible to booking team)" rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
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

// ─── Credit modal ────────────────────────────────────────────
function CreditModal({ accountId, account, onClose, onSaved }: { accountId: string; account: any; onClose: () => void; onSaved: () => void }) {
  const [limit, setLimit] = useState(String(account.creditLimit || 0));
  const [period, setPeriod] = useState(account.creditPeriod || '');
  const [onTime, setOnTime] = useState(account.onTimePct || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditLimit: Number(limit), creditPeriod: period || null, onTimePct: onTime || null }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }
  return (
    <ModalShell title="Credit policy" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary></>}>
      <Field label="Credit limit (₹)"><input type="number" min="0" step="1" value={limit} onChange={e => setLimit(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Credit period"><input type="text" value={period} onChange={e => setPeriod(e.target.value)} placeholder="e.g. ≤30 days" style={inputStyle} /></Field>
        <Field label="On-time %"><input type="text" value={onTime} onChange={e => setOnTime(e.target.value)} placeholder="e.g. 82%" style={inputStyle} /></Field>
      </div>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── History modal (edit freeform Account.history text) ──────
function HistoryModal({ accountId, initial, onClose, onSaved }: { accountId: string; initial: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: text }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }
  return (
    <ModalShell title="Edit history" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary></>}>
      <Field label="History notes"><textarea value={text} onChange={e => setText(e.target.value)} rows={10} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} /></Field>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Form bits ──────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '10px 12px',
  border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
  outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit',
  background: '#fff',
};
function BtnPrimary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} style={{ background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>{children}</button>;
}
function BtnSecondary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} style={{ background: 'transparent', color: 'var(--t-2)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, padding: '10px 18px', fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }}>{children}</button>;
}

// ─── Legal case edit modal ───────────────────────────────────
const LEGAL_STATUSES = ['NoticeSent','Filed','InCourt','Settled','Recovered','Dropped','WrittenOff'] as const;
function LegalEditModal({ legal, onClose, onSaved }: { legal: any; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<string>(legal.status);
  const [lawyer, setLawyer] = useState(legal.lawyer || '');
  const [caseRef, setCaseRef] = useState(legal.caseRef || '');
  const [nextHearing, setNextHearing] = useState(legal.nextHearing ? String(legal.nextHearing).slice(0, 10) : '');
  const [notes, setNotes] = useState(legal.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/legal/${encodeURIComponent(legal.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status, lawyer: lawyer || null, caseRef: caseRef || null,
          nextHearing: nextHearing || null, notes: notes || null,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }

  return (
    <ModalShell title="Edit legal case" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary></>}>
      <Field label="Status">
        <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
          {LEGAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Lawyer"><input type="text" value={lawyer} onChange={e => setLawyer(e.target.value)} style={inputStyle} /></Field>
        <Field label="Case reference"><input type="text" value={caseRef} onChange={e => setCaseRef(e.target.value)} style={inputStyle} /></Field>
      </div>
      <Field label="Next hearing">
        <input type="date" value={nextHearing} onChange={e => setNextHearing(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Notes">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
      </Field>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Doubtful plan edit modal ────────────────────────────────
function DoubtfulEditModal({
  plan, instalments, onClose, onSaved,
}: {
  plan: any;
  instalments: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [planTotal, setPlanTotal] = useState(String(plan.planTotal ?? ''));
  const [startDate, setStartDate] = useState(String(plan.startDate ?? '').slice(0, 10));
  const [cancelled, setCancelled] = useState<boolean>(!!plan.cancelledAt);

  // Per-instalment editable state: status + received amount
  const [edits, setEdits] = useState<Record<string, { status?: string; received?: string }>>(
    () => Object.fromEntries(instalments.map(i => [i.id, {}]))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setInstField(id: string, field: 'status' | 'received', value: string) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const instUpdates = instalments
        .map(i => {
          const e = edits[i.id] || {};
          const out: any = { id: i.id };
          if (e.status !== undefined && e.status !== i.status) out.status = e.status;
          if (e.received !== undefined && Number(e.received) !== Number(i.received)) out.received = Number(e.received);
          return out;
        })
        .filter(u => Object.keys(u).length > 1); // has id + at least one field

      const body: any = {};
      if (Number(planTotal) !== Number(plan.planTotal)) body.planTotal = Number(planTotal);
      if (startDate !== String(plan.startDate).slice(0, 10)) body.startDate = startDate;
      if (cancelled !== !!plan.cancelledAt) body.cancelled = cancelled;
      if (instUpdates.length > 0) body.instalments = instUpdates;

      const r = await fetch(`/api/payment-plans/${encodeURIComponent(plan.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }

  return (
    <ModalShell title="Edit doubtful plan" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Plan total (₹)">
          <input type="number" min="0" step="1" value={planTotal} onChange={e => setPlanTotal(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
        </Field>
        <Field label="Start date">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
        </Field>
      </div>

      <Field label="Instalments">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {instalments.map(i => {
            const e = edits[i.id] || {};
            const curStatus = e.status ?? i.status;
            const curReceived = e.received ?? String(i.received);
            return (
              <div key={i.id} style={{
                display: 'grid', gridTemplateColumns: '46px 110px 1fr 100px',
                gap: 10, alignItems: 'center', fontSize: 12,
                padding: '8px 10px', background: '#fff',
                border: '1px solid var(--line, #e7eaf0)', borderRadius: 6,
              }}>
                <div style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{i.instNo}/{instalments.length}</div>
                <div style={{ color: 'var(--t-3)', fontFamily: "'JetBrains Mono', monospace" }}>{fmtDate(i.dueDate)}</div>
                <select value={curStatus} onChange={e2 => setInstField(i.id, 'status', e2.target.value)} style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}>
                  <option value="Pending">Pending</option>
                  <option value="Received">Received</option>
                  <option value="Broken">Broken</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
                <input
                  type="number" min="0" step="1"
                  value={curReceived}
                  onChange={e2 => setInstField(i.id, 'received', e2.target.value)}
                  placeholder="Received"
                  style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}
                />
              </div>
            );
          })}
        </div>
      </Field>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: cancelled ? 'var(--rust)' : 'var(--t-2)', marginTop: 4 }}>
        <input type="checkbox" checked={cancelled} onChange={e => setCancelled(e.target.checked)} />
        Cancel this plan (use when switching to direct legal review or refund)
      </label>

      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}

// ─── Contact edit modal ──────────────────────────────────────
function ContactEditModal({
  party, family, client, onClose, onSaved,
}: {
  party: string; family: string | null; client: any | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [phone1, setPhone1] = useState(client?.phone1 || '');
  const [phone2, setPhone2] = useState(client?.phone2 || '');
  const [whatsapp, setWhatsapp] = useState(client?.whatsapp || '');
  const [email, setEmail] = useState(client?.email || '');
  const [owner, setOwner] = useState(client?.owner || '');
  const [ap, setAp] = useState(client?.ap || '');
  const [admin, setAdmin] = useState(client?.admin || '');
  const [vip, setVip] = useState<'YES' | 'NO'>(client?.vip === 'YES' ? 'YES' : 'NO');
  const [address, setAddress] = useState(client?.address || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/clients/${encodeURIComponent(party)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone1: phone1 || null, phone2: phone2 || null,
          whatsapp: whatsapp || null, email: email || null,
          owner: owner || null, ap: ap || null, admin: admin || null,
          vip, address: address || null,
        }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }

  return (
    <ModalShell title="Edit contact details" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</BtnPrimary></>}>
      <div style={{ fontSize: 11, color: 'var(--t-3)', marginBottom: 14 }}>
        <strong style={{ color: 'var(--t-2)' }}>{party}</strong>{family ? ` · ${family}` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Phone"><input type="text" value={phone1} onChange={e => setPhone1(e.target.value)} style={inputStyle} /></Field>
        <Field label="Phone 2"><input type="text" value={phone2} onChange={e => setPhone2(e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="WhatsApp"><input type="text" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} style={inputStyle} /></Field>
        <Field label="Email"><input type="text" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <Field label="Owner"><input type="text" value={owner} onChange={e => setOwner(e.target.value)} style={inputStyle} /></Field>
        <Field label="AP"><input type="text" value={ap} onChange={e => setAp(e.target.value)} style={inputStyle} /></Field>
        <Field label="Admin"><input type="text" value={admin} onChange={e => setAdmin(e.target.value)} style={inputStyle} /></Field>
      </div>
      <Field label="VIP">
        <select value={vip} onChange={e => setVip(e.target.value as 'YES' | 'NO')} style={inputStyle}>
          <option value="NO">NO</option>
          <option value="YES">YES</option>
        </select>
      </Field>
      <Field label="Address">
        <textarea value={address} onChange={e => setAddress(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      </Field>
      {err && <div style={{ color: 'var(--rust)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </ModalShell>
  );
}
