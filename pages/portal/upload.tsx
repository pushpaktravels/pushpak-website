// ============================================================
// Upload & Refresh — three pickers + one Process & Refresh All button.
// ============================================================
// Matches the old Apps Script portal's layout:
//   ▸ Three icon-driven file pickers (Agewise / Familywise / Collectionwise)
//   ▸ Info panel listing what the refresh does
//   ▸ "Last refresh" timestamp + a single PROCESS & REFRESH ALL button
//
// All three files are sent in one multipart request to
// /api/upload/process-all and applied inside one transaction. Writes
// are bulk-batched via UNNEST so a 350-account refresh finishes in
// ~1-2 seconds.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Slot = 'agewise' | 'familywise' | 'clientwise' | 'customermaster';

type SlotMeta = {
  key: Slot;
  field: string;          // multipart field name
  title: string;
  subtitle: string;
  icon: React.ReactNode;
};

const SLOTS: SlotMeta[] = [
  {
    key: 'agewise', field: 'file_agewise',
    title: 'Agewise Report', subtitle: 'Net Outstanding by age bucket',
    icon: <AgewiseIcon />,
  },
  {
    key: 'familywise', field: 'file_familywise',
    title: 'Familywise Report', subtitle: 'Group-level rollups',
    icon: <FamilywiseIcon />,
  },
  {
    key: 'clientwise', field: 'file_clientwise',
    title: 'Collectionwise Report', subtitle: 'Maps party → executive',
    icon: <ClientwiseIcon />,
  },
  {
    key: 'customermaster', field: 'file_customermaster',
    title: 'Customer Master', subtitle: 'Phones, emails, credit limits',
    icon: <CustomerMasterIcon />,
  },
];

const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1024*1024 ? `${(b/1024).toFixed(1)} KB` : `${(b/1024/1024).toFixed(2)} MB`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

type Picked = Partial<Record<Slot, File>>;
type DoneSummary = {
  agewise: any | null;
  familywise: any | null;
  clientwise: any | null;
  customermaster: any | null;
  elapsedMs: number;
};

export default function UploadPage() {
  return (
    <AppShell title="Upload & Refresh" crumb="Upload & Refresh">
      <UploadInner />
    </AppShell>
  );
}

function UploadInner() {
  const [picked, setPicked] = useState<Picked>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneSummary | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  useEffect(() => { loadLastRefresh(); }, []);
  useEffect(() => { if (done) loadLastRefresh(); }, [done]);

  async function loadLastRefresh() {
    try {
      const r = await fetch('/api/upload/history');
      const d = await r.json();
      if (d.ok && d.refreshes?.[0]) setLastRefresh(d.refreshes[0].ts);
    } catch {}
  }

  function setSlot(slot: Slot, f: File | null) {
    setError(null); setDone(null);
    setPicked(p => {
      const next = { ...p };
      if (f) next[slot] = f; else delete next[slot];
      return next;
    });
  }

  const pickedCount = Object.keys(picked).length;

  async function processAll() {
    if (pickedCount === 0 || busy) return;
    setBusy(true); setError(null); setDone(null);
    const fd = new FormData();
    for (const slot of SLOTS) {
      const f = picked[slot.key];
      if (f) fd.append(slot.field, f);
    }
    try {
      const r = await fetch('/api/upload/process-all', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || 'Refresh failed');
      } else {
        setDone(d.summary);
        setPicked({});
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '4px 4px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Upload & Refresh</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          Drop the 3 FinBook exports. The system handles everything else.
        </div>
      </div>

      <div style={{
        display: 'grid', gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        marginBottom: 22,
      }}>
        {SLOTS.map(slot => (
          <PickerCard
            key={slot.key}
            slot={slot}
            file={picked[slot.key] || null}
            onFile={f => setSlot(slot.key, f)}
            disabled={busy}
          />
        ))}
      </div>

      {/* Info panel */}
      <div style={{
        padding: '16px 22px', borderRadius: 12,
        background: 'rgba(15,40,85,0.04)',
        borderLeft: '3px solid var(--navy-deep, #0F2855)',
        marginBottom: 22,
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>
          When you click Process & Refresh:
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.9 }}>
          <li>Accounts merged + re-tiered by age bucket</li>
          <li>Outstanding, 0-30, 31-60, 61-90 and 90+ buckets updated on every party</li>
          <li>Collections detected automatically (outstanding decreased)</li>
          <li>Promise Ledger marks Kept / Broken; promises kept are stamped</li>
          <li>Booking Hold list refreshes — new candidates flagged over limit / 90+ threshold</li>
          <li>Family + Exec assignments updated from Familywise / Collectionwise files</li>
          <li>Refresh log entry written for audit</li>
        </ul>
      </div>

      {error && (
        <div style={{
          marginBottom: 16, padding: '12px 16px',
          background: 'rgba(181,72,61,0.08)', border: '1px solid rgba(181,72,61,0.28)',
          borderRadius: 10, color: 'var(--rust, #B5483D)', fontSize: 13,
        }}>
          <b>Refresh failed:</b> {error}
        </div>
      )}

      {/* Done summary */}
      {done && <DoneCard summary={done} />}

      {/* Footer row */}
      <div style={{
        marginTop: 18,
        display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
          Last refresh: <b style={{ color: 'var(--ink)' }}>{lastRefresh ? fmtDate(lastRefresh) : '—'}</b>
        </div>
        <button
          onClick={processAll}
          disabled={pickedCount === 0 || busy}
          style={{
            marginLeft: 'auto', minWidth: 240,
            padding: '14px 26px', borderRadius: 10,
            background: pickedCount === 0 || busy
              ? 'rgba(15,40,85,0.25)'
              : 'linear-gradient(180deg,#1A3F7E,#0F2855)',
            color: '#fff', border: 'none',
            fontSize: 12, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase',
            cursor: pickedCount === 0 || busy ? 'not-allowed' : 'pointer',
            boxShadow: pickedCount === 0 || busy ? 'none' : '0 6px 18px rgba(15,40,85,0.18)',
          }}
        >
          {busy ? 'Processing…' : pickedCount === 0 ? 'Pick a file to start' : `Process & Refresh ${pickedCount === 3 ? 'All' : `(${pickedCount})`} →`}
        </button>
      </div>
    </div>
  );
}

// ─── One picker card ─────────────────────────────────────────
function PickerCard({
  slot, file, onFile, disabled,
}: { slot: SlotMeta; file: File | null; onFile: (f: File | null) => void; disabled: boolean }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const has = !!file;

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${has ? 'var(--sage, #2E6C54)' : dragOver ? 'var(--navy-deep, #0F2855)' : 'rgba(15,40,85,0.22)'}`,
        background: has
          ? 'rgba(46,108,84,0.06)'
          : dragOver
            ? 'rgba(15,40,85,0.05)'
            : 'rgba(255,255,255,0.55)',
        borderRadius: 14, padding: '28px 22px',
        textAlign: 'center', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all .15s',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        minHeight: 220, opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        ref={inputRef} type="file" accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <div style={{ width: 56, height: 56, color: has ? 'var(--sage, #2E6C54)' : 'var(--navy-deep, #0F2855)', opacity: 0.85 }}>
        {has ? <CheckIcon /> : slot.icon}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>{slot.title}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: -4 }}>{slot.subtitle}</div>
      {has ? (
        <>
          <div style={{
            fontSize: 12.5, fontWeight: 600, color: 'var(--sage, #2E6C54)',
            marginTop: 6, padding: '4px 10px', borderRadius: 999,
            background: 'rgba(46,108,84,0.10)',
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {file!.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
            <span>{fmtSize(file!.size)}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
              style={{
                background: 'transparent', border: 'none', color: 'var(--rust, #B5483D)',
                cursor: 'pointer', fontSize: 11, fontWeight: 700,
                letterSpacing: '.16em', textTransform: 'uppercase',
              }}>Remove</button>
          </div>
        </>
      ) : (
        <div style={{
          marginTop: 'auto', display: 'flex', gap: 6, fontSize: 10.5,
          color: 'var(--ink-soft)', letterSpacing: '.22em', textTransform: 'uppercase', fontWeight: 700,
        }}>
          <span>.xlsx</span><span>·</span><span>.xls</span><span>·</span><span>.csv</span>
        </div>
      )}
    </div>
  );
}

// ─── After-refresh card ─────────────────────────────────────
function DoneCard({ summary }: { summary: DoneSummary }) {
  const a = summary.agewise; const f = summary.familywise; const c = summary.clientwise; const m = summary.customermaster;
  return (
    <div style={{
      marginTop: 4, marginBottom: 4, padding: 22, borderRadius: 14,
      background: 'linear-gradient(180deg, rgba(46,108,84,0.10), rgba(46,108,84,0.04))',
      border: '1px solid rgba(46,108,84,0.30)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 999, background: 'var(--sage, #2E6C54)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>✓</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Refresh applied</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            Completed in {summary.elapsedMs < 1000 ? `${summary.elapsedMs} ms` : `${(summary.elapsedMs/1000).toFixed(1)} s`}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {a && (
          <DoneCol title="Agewise">
            <Row label="Rows in file"   v={String(a.fileRows)} />
            <Row label="New accounts"   v={String(a.createCount)} />
            <Row label="Updated"        v={String(a.updateCount)} />
            <Row label="Cleared"        v={String(a.closeCount)} />
            <Row label="Collections"    v={`${a.collectionCount} · ${fmtINR(a.collectionAmount)}`} accent="sage" />
            <Row label="Promises kept"  v={String(a.promisesKeptCount)} accent="sage" />
            <Row label="Holds raised"   v={String(a.holdCount)} />
            <Row label="Total outstanding" v={fmtINR(a.totalOutstanding)} bold />
          </DoneCol>
        )}
        {f && (
          <DoneCol title="Familywise">
            <Row label="Rows in file"        v={String(f.fileRows)} />
            <Row label="Distinct families"   v={String(f.distinctFamilies)} />
            <Row label="Family reassigned"   v={String(f.updateCount)} accent="sage" />
            <Row label="Accounts created"    v={String(f.createCount)} />
            <Row label="No change"           v={String(f.unchanged)} />
          </DoneCol>
        )}
        {c && (
          <DoneCol title="Collectionwise">
            <Row label="Rows in file"      v={String(c.fileRows)} />
            <Row label="Distinct execs"    v={String(c.distinctExecs)} />
            <Row label="Exec reassigned"   v={String(c.updateCount)} accent="sage" />
            <Row label="Accounts created"  v={String(c.createCount)} />
            <Row label="No change"         v={String(c.unchanged)} />
          </DoneCol>
        )}
        {m && (
          <DoneCol title="Customer Master">
            <Row label="Rows in file"      v={String(m.fileRows)} />
            <Row label="Contacts added"    v={String(m.createCount)} accent="sage" />
            <Row label="Contacts updated"  v={String(m.updateCount)} />
            <Row label="No change"         v={String(m.unchanged)} />
            <Row label="With phone"        v={String(m.withPhone)} />
            <Row label="With email"        v={String(m.withEmail)} />
            {m.noAccount > 0 && <Row label="No matching account" v={String(m.noAccount)} accent="rust" />}
          </DoneCol>
        )}
      </div>
    </div>
  );
}

function DoneCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ label, v, accent, bold }: { label: string; v: string; accent?: 'sage' | 'rust'; bold?: boolean }) {
  const color = accent === 'sage' ? 'var(--sage, #2E6C54)' : accent === 'rust' ? 'var(--rust, #B5483D)' : 'var(--ink)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-soft)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: bold ? 14 : 12.5, fontWeight: bold ? 700 : 600, color, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────
function AgewiseIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">
      <rect x="10" y="36" width="9" height="18" rx="1.5" fill="rgba(46,108,84,0.18)" />
      <rect x="23" y="24" width="9" height="30" rx="1.5" fill="rgba(15,40,85,0.18)" />
      <rect x="36" y="14" width="9" height="40" rx="1.5" fill="rgba(201,164,114,0.30)" />
      <rect x="49" y="30" width="6" height="24" rx="1.5" fill="rgba(181,72,61,0.30)" />
      <path d="M8 54 L58 54" />
    </svg>
  );
}
function FamilywiseIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">
      <circle cx="20" cy="22" r="6" fill="rgba(15,40,85,0.12)" />
      <circle cx="44" cy="22" r="6" fill="rgba(15,40,85,0.12)" />
      <circle cx="32" cy="36" r="5" fill="rgba(201,164,114,0.30)" />
      <path d="M8 54 c0-7 5-12 12-12 s12 5 12 12" />
      <path d="M32 54 c0-7 5-12 12-12 s12 5 12 12" />
      <path d="M20 28 v6 M44 28 v6 M32 41 v2" />
    </svg>
  );
}
function ClientwiseIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">
      <circle cx="24" cy="22" r="6" fill="rgba(15,40,85,0.16)" />
      <circle cx="44" cy="26" r="5" fill="rgba(46,108,84,0.20)" />
      <path d="M12 50 c0-7 5-12 12-12 s12 5 12 12" />
      <path d="M36 52 c0-6 4-10 8-10 s8 4 8 10" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">
      <circle cx="32" cy="32" r="26" fill="rgba(46,108,84,0.12)" />
      <path d="M20 33 L29 42 L46 24" />
    </svg>
  );
}
function CustomerMasterIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">
      <rect x="10" y="14" width="44" height="38" rx="4" fill="rgba(201,164,114,0.20)" />
      <circle cx="22" cy="26" r="4" fill="rgba(15,40,85,0.18)" />
      <path d="M14 42 c0-4 4-7 8-7 s8 3 8 7" />
      <path d="M34 24 L50 24 M34 30 L50 30 M34 36 L46 36" />
    </svg>
  );
}
