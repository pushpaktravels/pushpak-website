// ============================================================
// Upload & Refresh — drop a FinBook XLS, preview the diff, commit.
// ============================================================
// Two-step flow:
//   1. User drops file → POST /api/upload/parse → preview modal
//      shows summary numbers + samples of every change category.
//   2. User clicks "Apply refresh" → POST /api/upload/commit with
//      the same File → atomic write → success toast + history reload.
//
// Owner / Admin only. The page is fully self-contained (no external
// charts library), so the bundle stays small.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Summary = {
  fileRows: number;
  currentAccounts: number;
  finalAccounts: number;
  totalOutstanding: number;
  prevTotalOutstanding: number;
  delta: number;
  createCount: number;
  updateCount: number;
  closeCount: number;
  collectionCount: number;
  collectionAmount: number;
  holdCount: number;
  promisesKeptCount: number;
};

type Preview = {
  ok: boolean;
  file: { name: string; size: number };
  sheetName: string;
  headers: string[];
  columnMap: Record<string, number>;
  warnings: string[];
  summary: Summary;
  sample: {
    creates: Array<{ party: string; exec: string | null; family: string | null; bill: number; d30: number; d60: number; d90: number; d90p: number }>;
    updates: Array<{ party: string; changes: string[]; before: { bill: number }; after: { bill: number } }>;
    closes: Array<{ party: string; before: { bill: number } }>;
    collections: Array<{ party: string; amount: number; prevOutstanding: number; newOutstanding: number; exec: string | null }>;
    holds: Array<{ party: string; outstanding: number; reason: string }>;
    promisesKept: Array<{ promiseId: string; party: string; outstandingNow: number }>;
    tierSuggestions: Array<{ party: string; from: string; to: string }>;
  };
};

type RefreshRow = {
  id: string;
  ts: string;
  byWhom: string;
  accountCount: number;
  totalOutstanding: number;
  delta: number;
  promisesKept: number;
  newHoldCandidates: number;
  newCollections: number;
  notes: string | null;
};

const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1024*1024 ? `${(b/1024).toFixed(1)} KB` : `${(b/1024/1024).toFixed(2)} MB`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function UploadPage() {
  return (
    <AppShell title="Upload & Refresh" crumb="Upload & Refresh">
      <UploadInner />
    </AppShell>
  );
}

function UploadInner() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'parsing' | 'preview' | 'committing' | 'done'>('idle');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneSummary, setDoneSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<RefreshRow[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { loadHistory(); }, []);
  useEffect(() => {
    if (phase === 'done') { loadHistory(); }
  }, [phase]);

  async function loadHistory() {
    try {
      const r = await fetch('/api/upload/history');
      const d = await r.json();
      if (d.ok) setHistory(d.refreshes || []);
    } catch {}
  }

  function reset() {
    setFile(null); setPreview(null); setError(null);
    setPhase('idle'); setDoneSummary(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function startParse(f: File) {
    setFile(f); setError(null); setPhase('parsing');
    const fd = new FormData(); fd.append('file', f);
    try {
      const r = await fetch('/api/upload/parse', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || 'Parse failed');
        setPhase('idle');
        return;
      }
      setPreview(d as Preview);
      setPhase('preview');
    } catch (e: any) {
      setError(e.message || 'Network error');
      setPhase('idle');
    }
  }

  async function commit() {
    if (!file) return;
    setPhase('committing'); setError(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch('/api/upload/commit', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || 'Commit failed');
        setPhase('preview');
        return;
      }
      setDoneSummary(d.summary);
      setPhase('done');
    } catch (e: any) {
      setError(e.message || 'Network error');
      setPhase('preview');
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) startParse(f);
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 4px 60px' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Upload & Refresh</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.55 }}>
          Drop your latest FinBook outstanding/ageing export. The system parses it, shows a complete preview
          of every change it would make, and only writes once you click <b>Apply refresh</b>.
        </p>
      </div>

      {/* Dropzone — disabled while preview is open */}
      {phase !== 'preview' && phase !== 'committing' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--gold, #C9A472)' : 'rgba(15,40,85,0.18)'}`,
            background: dragOver ? 'rgba(201,164,114,0.06)' : 'rgba(255,255,255,0.6)',
            borderRadius: 14, padding: '54px 28px', textAlign: 'center',
            cursor: 'pointer', transition: 'all .15s',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) startParse(f); }}
          />
          <div style={{ fontSize: 38, marginBottom: 14, opacity: 0.5 }}>⤴</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            {phase === 'parsing'
              ? `Parsing ${file?.name}…`
              : 'Drop a FinBook XLS, XLSX, or CSV here'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {phase === 'parsing' ? 'This usually takes a couple of seconds.' : 'or click anywhere in this box to pick a file'}
          </div>
          <div style={{
            marginTop: 18, display: 'inline-flex', gap: 8, fontSize: 11,
            color: 'var(--ink-soft)', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700,
          }}>
            <span>.xlsx</span><span>·</span><span>.xls</span><span>·</span><span>.csv</span><span>·</span><span>10 MB max</span>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          marginTop: 18, padding: '14px 16px',
          background: 'rgba(181,72,61,0.08)', border: '1px solid rgba(181,72,61,0.28)',
          borderRadius: 10, color: 'var(--rust, #B5483D)', fontSize: 13,
        }}>
          <b>Upload failed:</b> {error}
        </div>
      )}

      {/* Done card */}
      {phase === 'done' && doneSummary && (
        <DoneCard summary={doneSummary} onReset={reset} />
      )}

      {/* Preview overlay */}
      {phase === 'preview' && preview && (
        <PreviewModal
          preview={preview}
          busy={false}
          onCancel={reset}
          onConfirm={commit}
        />
      )}
      {phase === 'committing' && preview && (
        <PreviewModal
          preview={preview}
          busy={true}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      )}

      {/* History list */}
      <RefreshHistory rows={history} />
    </div>
  );
}

// ─── Done summary card ─────────────────────────────────────────
function DoneCard({ summary, onReset }: { summary: Summary; onReset: () => void }) {
  return (
    <div style={{
      marginTop: 24, padding: 24, borderRadius: 14,
      background: 'linear-gradient(180deg, rgba(46,108,84,0.10), rgba(46,108,84,0.04))',
      border: '1px solid rgba(46,108,84,0.30)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 999, background: 'var(--sage, #2E6C54)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>✓</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Refresh applied</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {summary.finalAccounts.toLocaleString('en-IN')} accounts · total outstanding {fmtINR(summary.totalOutstanding)}
          </div>
        </div>
        <button onClick={onReset} style={{
          marginLeft: 'auto', padding: '8px 14px', borderRadius: 8,
          background: 'var(--navy-deep, #0F2855)', color: '#fff', border: 'none',
          fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', cursor: 'pointer',
        }}>Upload another</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        <Stat label="Created"     value={summary.createCount.toLocaleString('en-IN')} />
        <Stat label="Updated"     value={summary.updateCount.toLocaleString('en-IN')} />
        <Stat label="Cleared"     value={summary.closeCount.toLocaleString('en-IN')} />
        <Stat label="Collections" value={summary.collectionCount.toLocaleString('en-IN')} />
        <Stat label="Recovered"   value={fmtINR(summary.collectionAmount)} />
        <Stat label="Holds added" value={summary.holdCount.toLocaleString('en-IN')} />
        <Stat label="Promises kept" value={summary.promisesKeptCount.toLocaleString('en-IN')} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

// ─── Preview modal ─────────────────────────────────────────────
function PreviewModal({
  preview, busy, onCancel, onConfirm,
}: {
  preview: Preview; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const s = preview.summary;
  const sp = preview.sample;
  const deltaSign = s.delta >= 0 ? '+' : '−';
  const deltaColor = s.delta > 0 ? 'var(--rust, #B5483D)' : 'var(--sage, #2E6C54)';

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
        {/* Header */}
        <div style={{ padding: '20px 26px 16px', borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Refresh preview</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                {preview.file.name} · sheet <b>{preview.sheetName}</b> · {fmtSize(preview.file.size)}
              </div>
            </div>
            <button onClick={onCancel} disabled={busy} style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              fontSize: 22, color: 'var(--ink-soft)', cursor: busy ? 'wait' : 'pointer', padding: 4,
            }}>×</button>
          </div>

          {/* Warning bar */}
          {preview.warnings && preview.warnings.length > 0 && (
            <div style={{
              marginTop: 12, padding: '10px 12px',
              background: 'rgba(201,164,114,0.10)', border: '1px solid rgba(201,164,114,0.35)',
              borderRadius: 8, fontSize: 12, color: 'var(--ink)',
            }}>
              {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </div>

        {/* Summary strip */}
        <div style={{
          padding: '16px 26px', borderBottom: '1px solid rgba(15,40,85,0.08)',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10,
        }}>
          <BigStat label="Rows in file" value={s.fileRows.toLocaleString('en-IN')} />
          <BigStat label="New accounts" value={s.createCount.toLocaleString('en-IN')} accent={s.createCount > 0 ? 'sage' : undefined} />
          <BigStat label="Updates" value={s.updateCount.toLocaleString('en-IN')} />
          <BigStat label="Cleared" value={s.closeCount.toLocaleString('en-IN')} />
          <BigStat label="Collections" value={`${s.collectionCount.toLocaleString('en-IN')} · ${fmtINR(s.collectionAmount)}`} accent="sage" />
          <BigStat label="Promises kept" value={s.promisesKeptCount.toLocaleString('en-IN')} accent={s.promisesKeptCount > 0 ? 'sage' : undefined} />
          <BigStat label="New hold candidates" value={s.holdCount.toLocaleString('en-IN')} accent={s.holdCount > 0 ? 'rust' : undefined} />
          <BigStat
            label="Total outstanding"
            value={fmtINR(s.totalOutstanding)}
            sub={<span style={{ color: deltaColor, fontWeight: 700 }}>{deltaSign}{fmtINR(Math.abs(s.delta))}</span>}
          />
        </div>

        {/* Tabs / sample lists */}
        <div className="scroll" style={{ overflowY: 'auto', padding: '14px 26px', flex: 1 }}>
          <SampleSection title="New accounts" empty="No new accounts." rows={sp.creates.map(c => ({
            party: c.party,
            right: fmtINR(c.bill),
            note: [c.exec && `Exec ${c.exec}`, c.family && `Family ${c.family}`].filter(Boolean).join(' · ') || null,
          }))} more={s.createCount - sp.creates.length} />

          <SampleSection title="Updated accounts" empty="No outstanding/exec changes." rows={sp.updates.map(u => ({
            party: u.party,
            right: `${fmtINR(u.before.bill)} → ${fmtINR(u.after.bill)}`,
            note: u.changes.slice(0, 3).join(' · ') + (u.changes.length > 3 ? ` +${u.changes.length - 3} more` : ''),
          }))} more={s.updateCount - sp.updates.length} />

          <SampleSection title="Collections (outstanding dropped)" empty="No collections detected this refresh." rows={sp.collections.map(c => ({
            party: c.party,
            right: `${fmtINR(c.amount)} recovered`,
            note: [c.exec, `${fmtINR(c.prevOutstanding)} → ${fmtINR(c.newOutstanding)}`].filter(Boolean).join(' · '),
            accent: 'sage' as const,
          }))} more={s.collectionCount - sp.collections.length} />

          <SampleSection title="Promises kept" empty="No open promises matched a payment." rows={sp.promisesKept.map(p => ({
            party: p.party,
            right: `now ${fmtINR(p.outstandingNow)}`,
            note: 'Will be marked Kept',
            accent: 'sage' as const,
          }))} more={s.promisesKeptCount - sp.promisesKept.length} />

          <SampleSection title="New hold candidates" empty="No new accounts crossed the hold threshold." rows={sp.holds.map(h => ({
            party: h.party,
            right: fmtINR(h.outstanding),
            note: h.reason,
            accent: 'rust' as const,
          }))} more={s.holdCount - sp.holds.length} />

          <SampleSection title="Cleared accounts (gone from file)" empty="No accounts dropped to zero." rows={sp.closes.map(c => ({
            party: c.party,
            right: `${fmtINR(c.before.bill)} → ₹0`,
            note: 'Set to zero (kept in history)',
          }))} more={s.closeCount - sp.closes.length} />

          <SampleSection title="Tier suggestions" empty="No tier changes suggested." rows={sp.tierSuggestions.map(t => ({
            party: t.party,
            right: `${t.from} → ${t.to}`,
            note: 'Applied unless tier is manually overridden',
          }))} more={0} />
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 26px', borderTop: '1px solid rgba(15,40,85,0.10)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            Atomic refresh: if any single write fails, nothing is applied.
            <br />A row is added to the Refresh log for audit.
          </div>
          <button onClick={onCancel} disabled={busy} style={{
            marginLeft: 'auto', padding: '11px 18px', borderRadius: 8,
            background: 'transparent', color: 'var(--ink)', border: '1px solid rgba(15,40,85,0.22)',
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase',
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
          }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy} style={{
            padding: '11px 22px', borderRadius: 8,
            background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none',
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase',
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1, minWidth: 180,
          }}>
            {busy ? 'Applying…' : 'Apply refresh →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BigStat({
  label, value, sub, accent,
}: { label: string; value: string; sub?: React.ReactNode; accent?: 'sage' | 'rust' }) {
  const color =
    accent === 'sage' ? 'var(--sage, #2E6C54)' :
    accent === 'rust' ? 'var(--rust, #B5483D)' : 'var(--ink)';
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
}: {
  title: string; empty: string; more: number;
  rows: Array<{ party: string; right: string; note: string | null; accent?: 'sage' | 'rust' }>;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8,
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{rows.length === 0 ? '—' : `${rows.length} shown`}{more > 0 ? ` · +${more} more` : ''}</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{empty}</div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((r, i) => {
            const color =
              r.accent === 'sage' ? 'var(--sage, #2E6C54)' :
              r.accent === 'rust' ? 'var(--rust, #B5483D)' : 'var(--ink)';
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
                <div style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.right}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── History list ──────────────────────────────────────────────
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
