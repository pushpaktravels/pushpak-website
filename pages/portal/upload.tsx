// ============================================================
// Upload & Refresh — three dedicated FinBook report uploaders.
// ============================================================
// Vanshika exports three reports from FinBook for every refresh:
//
//   Agewise      — financial truth (outstanding + ageing buckets).
//   Clientwise   — who's the exec/owner of each party.
//   Familywise   — which family group each party rolls up to.
//
// Each card has its own dropzone and runs through the same
// parse → preview-modal → commit flow. The right preview rendering
// is chosen based on the report type.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type ReportType = 'agewise' | 'clientwise' | 'familywise';

type AgewiseSummary = {
  fileRows: number; currentAccounts: number; finalAccounts: number;
  totalOutstanding: number; prevTotalOutstanding: number; delta: number;
  createCount: number; updateCount: number; closeCount: number;
  collectionCount: number; collectionAmount: number;
  holdCount: number; promisesKeptCount: number;
};
type ClientwiseSummary = {
  fileRows: number; distinctExecs: number;
  createCount: number; updateCount: number; unchanged: number; ungrouped: number;
};
type FamilywiseSummary = {
  fileRows: number; distinctFamilies: number;
  createCount: number; updateCount: number; unchanged: number; ungrouped: number;
};

type AnyPreview = {
  ok: true;
  reportType: ReportType;
  file: { name: string; size: number };
  sheetName: string;
  headers: string[];
  grandTotal: number;
  warnings: string[];
  emptyExecs?: string[];
  emptyFamilies?: string[];
  summary: any;
  sample: any;
};

type RefreshRow = {
  id: string; ts: string; byWhom: string;
  accountCount: number; totalOutstanding: number; delta: number;
  promisesKept: number; newHoldCandidates: number; newCollections: number;
  notes: string | null;
};

const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1024*1024 ? `${(b/1024).toFixed(1)} KB` : `${(b/1024/1024).toFixed(2)} MB`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const META: Record<ReportType, {
  title: string; subtitle: string; explainer: string; tag: string;
}> = {
  agewise: {
    title: 'Agewise', tag: 'PRIMARY',
    subtitle: 'Outstanding + ageing buckets',
    explainer: 'Updates bill amount and 0-30 / 31-60 / 61-90 / 90+ buckets on every account. Detects collections, marks promises kept, flags new hold candidates.',
  },
  clientwise: {
    title: 'Clientwise', tag: 'METADATA',
    subtitle: 'Exec assignment',
    explainer: 'Tags each party with the FinBook "client" (exec / sales person) responsible for them. Only updates the exec field — no outstanding changes.',
  },
  familywise: {
    title: 'Familywise', tag: 'METADATA',
    subtitle: 'Family group',
    explainer: 'Rolls each party up to its parent family/group (e.g. PATEL GROUP). Only updates the family field — no outstanding changes.',
  },
};

export default function UploadPage() {
  return (
    <AppShell title="Upload & Refresh" crumb="Upload & Refresh">
      <UploadInner />
    </AppShell>
  );
}

function UploadInner() {
  const [history, setHistory] = useState<RefreshRow[]>([]);
  const [activeModal, setActiveModal] = useState<{ preview: AnyPreview; file: File; busy: boolean; done: any | null; error: string | null } | null>(null);

  async function loadHistory() {
    try {
      const r = await fetch('/api/upload/history');
      const d = await r.json();
      if (d.ok) setHistory(d.refreshes || []);
    } catch {}
  }
  useEffect(() => { loadHistory(); }, []);

  async function onParsed(preview: AnyPreview, file: File) {
    setActiveModal({ preview, file, busy: false, done: null, error: null });
  }

  async function commit() {
    if (!activeModal || activeModal.busy) return;
    setActiveModal({ ...activeModal, busy: true, error: null });
    const fd = new FormData();
    fd.append('file', activeModal.file);
    fd.append('reportType', activeModal.preview.reportType);
    try {
      const r = await fetch('/api/upload/commit', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) {
        setActiveModal({ ...activeModal, busy: false, error: d.error || 'Commit failed' });
        return;
      }
      setActiveModal({ ...activeModal, busy: false, done: d });
      loadHistory();
    } catch (e: any) {
      setActiveModal({ ...activeModal, busy: false, error: e.message || 'Network error' });
    }
  }

  function closeModal() { setActiveModal(null); }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '8px 4px 60px' }}>
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Upload & Refresh</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.55, maxWidth: 780 }}>
          Drop your three FinBook exports. Each one updates a different dimension of the same accounts. Start with <b>Agewise</b> for the outstanding numbers, then <b>Clientwise</b> and <b>Familywise</b> to tag each account with its exec and family group.
        </p>
      </div>

      <div style={{
        display: 'grid', gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
      }}>
        <UploadCard type="agewise"    accent="#0F2855" onParsed={onParsed} />
        <UploadCard type="clientwise" accent="#1E6E54" onParsed={onParsed} />
        <UploadCard type="familywise" accent="#8A5A1B" onParsed={onParsed} />
      </div>

      <RefreshHistory rows={history} />

      {activeModal && (
        <PreviewModal
          preview={activeModal.preview}
          busy={activeModal.busy}
          error={activeModal.error}
          done={activeModal.done}
          onCancel={closeModal}
          onConfirm={commit}
        />
      )}
    </div>
  );
}

// ─── One upload card ─────────────────────────────────────────
function UploadCard({
  type, accent, onParsed,
}: { type: ReportType; accent: string; onParsed: (p: AnyPreview, f: File) => void }) {
  const meta = META[type];
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function startParse(f: File) {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('reportType', type);
    try {
      const r = await fetch('/api/upload/parse', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) {
        const more = d.headers ? ` (headers found: ${d.headers.filter(Boolean).join(' | ')})` : '';
        setError((d.error || 'Parse failed') + more);
        setBusy(false);
        return;
      }
      setBusy(false);
      onParsed(d, f);
    } catch (e: any) {
      setError(e.message || 'Network error');
      setBusy(false);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) startParse(f);
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.65)',
      borderRadius: 14, padding: 18,
      border: '1px solid rgba(15,40,85,0.08)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{meta.title}</h3>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.22em',
              padding: '3px 7px', borderRadius: 4,
              background: accent, color: '#fff',
            }}>{meta.tag}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{meta.subtitle}</div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '4px 0 6px', lineHeight: 1.5 }}>{meta.explainer}</p>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? accent : 'rgba(15,40,85,0.18)'}`,
          background: dragOver ? `${accent}10` : 'rgba(255,255,255,0.6)',
          borderRadius: 10, padding: '30px 14px',
          textAlign: 'center', cursor: busy ? 'wait' : 'pointer',
          transition: 'all .15s', minHeight: 130,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) startParse(f); }} />
        <div style={{ fontSize: 28, opacity: 0.45 }}>⤴</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
          {busy ? 'Parsing…' : `Drop ${meta.title.toLowerCase()} XLS here`}
        </div>
        {!busy && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>or click to pick</div>}
      </div>

      {error && (
        <div style={{
          padding: '8px 10px', borderRadius: 8,
          background: 'rgba(181,72,61,0.08)', border: '1px solid rgba(181,72,61,0.25)',
          color: 'var(--rust, #B5483D)', fontSize: 11.5, lineHeight: 1.5,
        }}>{error}</div>
      )}
    </div>
  );
}

// ─── Preview modal — branches on report type ─────────────────
function PreviewModal({
  preview, busy, error, done, onCancel, onConfirm,
}: {
  preview: AnyPreview; busy: boolean;
  error: string | null; done: any | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const meta = META[preview.reportType];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,40,85,0.42)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }} onClick={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--paper, #F8F4EC)', borderRadius: 16,
        width: '100%', maxWidth: 980, maxHeight: '92vh',
        boxShadow: '0 30px 80px rgba(0,0,0,0.32)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 26px 14px', borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
                  {done ? `${meta.title} refresh applied` : `${meta.title} preview`}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                {preview.file.name} · sheet <b>{preview.sheetName}</b> · {fmtSize(preview.file.size)} · grand total {fmtINR(preview.grandTotal)}
              </div>
            </div>
            <button onClick={onCancel} disabled={busy} style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              fontSize: 22, color: 'var(--ink-soft)', cursor: busy ? 'wait' : 'pointer', padding: 4,
            }}>×</button>
          </div>

          {preview.warnings && preview.warnings.length > 0 && !done && (
            <div style={{
              marginTop: 10, padding: '8px 12px',
              background: 'rgba(201,164,114,0.12)', border: '1px solid rgba(201,164,114,0.35)',
              borderRadius: 8, fontSize: 12, color: 'var(--ink)',
            }}>
              {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </div>

        {done ? <DoneBody summary={done.summary} reportType={preview.reportType} /> :
          <PreviewBody preview={preview} />
        }

        {error && (
          <div style={{
            margin: '0 26px 12px', padding: '10px 12px',
            background: 'rgba(181,72,61,0.10)', border: '1px solid rgba(181,72,61,0.28)',
            borderRadius: 8, fontSize: 12.5, color: 'var(--rust, #B5483D)',
          }}>{error}</div>
        )}

        <div style={{
          padding: '14px 26px', borderTop: '1px solid rgba(15,40,85,0.10)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {!done && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              Atomic refresh — if any single write fails, the entire upload rolls back.
            </div>
          )}
          <button onClick={onCancel} disabled={busy} style={{
            marginLeft: 'auto', padding: '11px 18px', borderRadius: 8,
            background: 'transparent', color: 'var(--ink)', border: '1px solid rgba(15,40,85,0.22)',
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase',
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
          }}>{done ? 'Close' : 'Cancel'}</button>
          {!done && (
            <button onClick={onConfirm} disabled={busy} style={{
              padding: '11px 22px', borderRadius: 8,
              background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none',
              fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase',
              cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1, minWidth: 180,
            }}>{busy ? 'Applying…' : 'Apply refresh →'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Preview body branches ────────────────────────────────────
function PreviewBody({ preview }: { preview: AnyPreview }) {
  if (preview.reportType === 'agewise')    return <AgewisePreview preview={preview} />;
  if (preview.reportType === 'clientwise') return <ClientwisePreview preview={preview} />;
  return <FamilywisePreview preview={preview} />;
}

function AgewisePreview({ preview }: { preview: AnyPreview }) {
  const s = preview.summary as AgewiseSummary;
  const sp = preview.sample;
  const deltaSign = s.delta >= 0 ? '+' : '−';
  const deltaColor = s.delta > 0 ? 'var(--rust, #B5483D)' : 'var(--sage, #2E6C54)';
  return (
    <>
      <div style={{
        padding: '14px 26px', borderBottom: '1px solid rgba(15,40,85,0.08)',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10,
      }}>
        <Stat label="Rows in file" value={s.fileRows.toLocaleString('en-IN')} />
        <Stat label="New accounts" value={s.createCount.toLocaleString('en-IN')} accent={s.createCount > 0 ? 'sage' : undefined} />
        <Stat label="Updates" value={s.updateCount.toLocaleString('en-IN')} />
        <Stat label="Cleared" value={s.closeCount.toLocaleString('en-IN')} />
        <Stat label="Collections" value={`${s.collectionCount} · ${fmtINR(s.collectionAmount)}`} accent="sage" />
        <Stat label="Promises kept" value={s.promisesKeptCount.toLocaleString('en-IN')} accent={s.promisesKeptCount > 0 ? 'sage' : undefined} />
        <Stat label="New hold candidates" value={s.holdCount.toLocaleString('en-IN')} accent={s.holdCount > 0 ? 'rust' : undefined} />
        <Stat label="Total outstanding" value={fmtINR(s.totalOutstanding)}
          sub={<span style={{ color: deltaColor, fontWeight: 700 }}>{deltaSign}{fmtINR(Math.abs(s.delta))}</span>} />
      </div>
      <div className="scroll" style={{ overflowY: 'auto', padding: '14px 26px', flex: 1 }}>
        <SampleSection title="New accounts" empty="No new accounts." more={s.createCount - sp.creates.length}
          rows={sp.creates.map((c: any) => ({ party: c.party, right: fmtINR(c.bill), note: `0-30: ${fmtINR(c.d30)} · 31-60: ${fmtINR(c.d60)} · 61-90: ${fmtINR(c.d90)} · 90+: ${fmtINR(c.d90p)}` }))} />
        <SampleSection title="Updated accounts" empty="No outstanding changes." more={s.updateCount - sp.updates.length}
          rows={sp.updates.map((u: any) => ({ party: u.party, right: `${fmtINR(u.before.bill)} → ${fmtINR(u.after.bill)}`, note: u.changes.slice(0, 3).join(' · ') + (u.changes.length > 3 ? ` +${u.changes.length - 3}` : '') }))} />
        <SampleSection title="Collections (outstanding dropped)" empty="No collections detected." more={s.collectionCount - sp.collections.length}
          rows={sp.collections.map((c: any) => ({ party: c.party, right: `${fmtINR(c.amount)} recovered`, note: `${c.exec || '—'} · ${fmtINR(c.prevOutstanding)} → ${fmtINR(c.newOutstanding)}`, accent: 'sage' as const }))} />
        <SampleSection title="Promises kept" empty="No open promises matched a payment." more={s.promisesKeptCount - sp.promisesKept.length}
          rows={sp.promisesKept.map((p: any) => ({ party: p.party, right: `now ${fmtINR(p.outstandingNow)}`, note: 'Will be marked Kept', accent: 'sage' as const }))} />
        <SampleSection title="New hold candidates" empty="No new hold candidates." more={s.holdCount - sp.holds.length}
          rows={sp.holds.map((h: any) => ({ party: h.party, right: fmtINR(h.outstanding), note: h.reason, accent: 'rust' as const }))} />
        <SampleSection title="Cleared accounts (gone from file)" empty="No accounts went to zero." more={s.closeCount - sp.closes.length}
          rows={sp.closes.map((c: any) => ({ party: c.party, right: `${fmtINR(c.before.bill)} → ₹0`, note: 'Set to zero (kept in history)' }))} />
        <SampleSection title="Tier suggestions" empty="No tier changes suggested." more={0}
          rows={sp.tierSuggestions.map((t: any) => ({ party: t.party, right: `${t.from} → ${t.to}`, note: 'Applied unless tier is manually overridden' }))} />
      </div>
    </>
  );
}

function ClientwisePreview({ preview }: { preview: AnyPreview }) {
  const s = preview.summary as ClientwiseSummary;
  const sp = preview.sample;
  return (
    <>
      <div style={{
        padding: '14px 26px', borderBottom: '1px solid rgba(15,40,85,0.08)',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10,
      }}>
        <Stat label="Rows in file" value={s.fileRows.toLocaleString('en-IN')} />
        <Stat label="Distinct execs" value={s.distinctExecs.toString()} />
        <Stat label="Exec reassigned" value={s.updateCount.toLocaleString('en-IN')} accent={s.updateCount > 0 ? 'sage' : undefined} />
        <Stat label="New accounts created" value={s.createCount.toLocaleString('en-IN')} accent={s.createCount > 0 ? 'sage' : undefined} />
        <Stat label="No change" value={s.unchanged.toLocaleString('en-IN')} />
        <Stat label="Without exec" value={s.ungrouped.toLocaleString('en-IN')} accent={s.ungrouped > 0 ? 'rust' : undefined} />
      </div>
      <div className="scroll" style={{ overflowY: 'auto', padding: '14px 26px', flex: 1 }}>
        <SampleSection title="New accounts (with exec)" empty="No new accounts." more={s.createCount - sp.creates.length}
          rows={sp.creates.map((c: any) => ({ party: c.party, right: c.exec || '—', note: `Initial balance ${fmtINR(c.balance)}` }))} />
        <SampleSection title="Exec reassignments" empty="No exec changes." more={s.updateCount - sp.updates.length}
          rows={sp.updates.map((u: any) => ({ party: u.party, right: `${u.before || '—'} → ${u.after}`, note: 'Exec updated' }))} />
        <SampleSection title="Parties without an exec" empty="Every party in the file has an exec header above it. ✓" more={s.ungrouped - sp.ungrouped.length}
          rows={sp.ungrouped.map((u: any) => ({ party: u.party, right: fmtINR(u.balance), note: 'No exec header above this row in the file', accent: 'rust' as const }))} />
        {preview.emptyExecs && preview.emptyExecs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 6 }}>Execs with no parties</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {preview.emptyExecs.join(' · ')}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FamilywisePreview({ preview }: { preview: AnyPreview }) {
  const s = preview.summary as FamilywiseSummary;
  const sp = preview.sample;
  return (
    <>
      <div style={{
        padding: '14px 26px', borderBottom: '1px solid rgba(15,40,85,0.08)',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10,
      }}>
        <Stat label="Rows in file" value={s.fileRows.toLocaleString('en-IN')} />
        <Stat label="Distinct families" value={s.distinctFamilies.toString()} />
        <Stat label="Family reassigned" value={s.updateCount.toLocaleString('en-IN')} accent={s.updateCount > 0 ? 'sage' : undefined} />
        <Stat label="New accounts created" value={s.createCount.toLocaleString('en-IN')} accent={s.createCount > 0 ? 'sage' : undefined} />
        <Stat label="No change" value={s.unchanged.toLocaleString('en-IN')} />
        <Stat label="Without family" value={s.ungrouped.toLocaleString('en-IN')} accent={s.ungrouped > 0 ? 'rust' : undefined} />
      </div>
      <div className="scroll" style={{ overflowY: 'auto', padding: '14px 26px', flex: 1 }}>
        <SampleSection title="New accounts (with family)" empty="No new accounts." more={s.createCount - sp.creates.length}
          rows={sp.creates.map((c: any) => ({ party: c.party, right: c.family || '—', note: `Initial balance ${fmtINR(c.balance)}` }))} />
        <SampleSection title="Family reassignments" empty="No family changes." more={s.updateCount - sp.updates.length}
          rows={sp.updates.map((u: any) => ({ party: u.party, right: `${u.before || '—'} → ${u.after}`, note: 'Family updated' }))} />
        <SampleSection title="Parties without a family" empty="Every party in the file has a family header above it. ✓" more={s.ungrouped - sp.ungrouped.length}
          rows={sp.ungrouped.map((u: any) => ({ party: u.party, right: fmtINR(u.balance), note: 'No family header above this row in the file', accent: 'rust' as const }))} />
        {preview.emptyFamilies && preview.emptyFamilies.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 6 }}>Empty family headers (no parties under them)</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {preview.emptyFamilies.join(' · ')}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── After commit ─────────────────────────────────────────────
function DoneBody({ summary, reportType }: { summary: any; reportType: ReportType }) {
  return (
    <div style={{ padding: '24px 26px', flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 999, background: 'var(--sage, #2E6C54)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>✓</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>Refresh committed</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            {summary.fileRows.toLocaleString('en-IN')} rows applied across the {META[reportType].title.toLowerCase()} dimension
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {reportType === 'agewise' && (<>
          <Stat label="Created"        value={String(summary.createCount)} />
          <Stat label="Updated"        value={String(summary.updateCount)} />
          <Stat label="Cleared"        value={String(summary.closeCount)} />
          <Stat label="Collections"    value={String(summary.collectionCount)} accent="sage" />
          <Stat label="Recovered"      value={fmtINR(summary.collectionAmount)} accent="sage" />
          <Stat label="Holds added"    value={String(summary.holdCount)} />
          <Stat label="Promises kept"  value={String(summary.promisesKeptCount)} accent="sage" />
        </>)}
        {reportType === 'clientwise' && (<>
          <Stat label="Distinct execs"   value={String(summary.distinctExecs)} />
          <Stat label="Exec reassigned"  value={String(summary.updateCount)} accent="sage" />
          <Stat label="Accounts created" value={String(summary.createCount)} />
          <Stat label="No change"        value={String(summary.unchanged)} />
        </>)}
        {reportType === 'familywise' && (<>
          <Stat label="Distinct families"  value={String(summary.distinctFamilies)} />
          <Stat label="Family reassigned"  value={String(summary.updateCount)} accent="sage" />
          <Stat label="Accounts created"   value={String(summary.createCount)} />
          <Stat label="No change"          value={String(summary.unchanged)} />
        </>)}
      </div>
    </div>
  );
}

// ─── Reusable bits ────────────────────────────────────────────
function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: React.ReactNode; accent?: 'sage' | 'rust' }) {
  const color = accent === 'sage' ? 'var(--sage, #2E6C54)' : accent === 'rust' ? 'var(--rust, #B5483D)' : 'var(--ink)';
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.65)', borderRadius: 10 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{sub}</div>}
    </div>
  );
}

function SampleSection({
  title, rows, more, empty,
}: { title: string; empty: string; more: number;
  rows: Array<{ party: string; right: string; note: string | null; accent?: 'sage' | 'rust' }> }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{rows.length === 0 ? '—' : `${rows.length} shown`}{more > 0 ? ` · +${more} more` : ''}</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{empty}</div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((r, i) => {
            const color = r.accent === 'sage' ? 'var(--sage, #2E6C54)' : r.accent === 'rust' ? 'var(--rust, #B5483D)' : 'var(--ink)';
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderBottom: i === rows.length - 1 ? 'none' : '1px solid rgba(15,40,85,0.06)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.party}</div>
                  {r.note && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</div>}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' }}>{r.right}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RefreshHistory({ rows }: { rows: RefreshRow[] }) {
  return (
    <div style={{ marginTop: 36 }}>
      <div style={{
        fontSize: 11.5, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase',
        color: 'var(--ink-soft)', marginBottom: 12,
      }}>Recent refreshes</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic', padding: '14px 0' }}>
          No refreshes yet. Drop a file above to do your first one.
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: 12, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{
              display: 'grid',
              gridTemplateColumns: '170px 110px 1fr 130px 130px',
              alignItems: 'center', gap: 14,
              padding: '12px 16px',
              borderBottom: i === rows.length - 1 ? 'none' : '1px solid rgba(15,40,85,0.06)',
              fontSize: 12.5,
            }}>
              <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{fmtDate(r.ts)}</div>
              <div style={{ color: 'var(--ink-soft)' }}>by {r.byWhom}</div>
              <div style={{ color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.notes || '—'}
              </div>
              <div style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {r.accountCount.toLocaleString('en-IN')} accts
              </div>
              <div style={{
                color: r.delta > 0 ? 'var(--rust, #B5483D)' : 'var(--sage, #2E6C54)',
                fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right',
              }}>
                {r.delta >= 0 ? '+' : '−'}{fmtINR(Math.abs(r.delta))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
