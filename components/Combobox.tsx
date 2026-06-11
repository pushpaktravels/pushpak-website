// ============================================================
// Combobox — inline typeahead form field with optional "add new".
// ============================================================
// The shared engine behind ClientPicker / VendorPicker. Unlike the big
// standalone AccountSearch box, this is a drop-in <input> replacement that
// lives inside a form: it is bound to a plain string `value`, so a FREE-TYPED
// name is always preserved even if it matches nothing in the master — no one
// is ever blocked. As the user types it debounce-searches; matches show in a
// dropdown; picking one writes the canonical value (and hands back the full
// record as `meta`). If `onCreate` is given and the typed text matches no
// existing row, an "add new" line lets the user persist it inline.
//
// Keyboard: ↑/↓ move, Enter picks the highlighted row (or creates), Esc closes.
// Enter is only intercepted while the panel is usable, so it never silently
// swallows a form submit.
// ============================================================
import { useEffect, useRef, useState } from 'react';

export type ComboOption = {
  value: string;     // canonical value written into the field (party / vendor name)
  label: string;     // primary line in the dropdown
  sub?: string;      // muted secondary line
  right?: string;    // right-aligned hint (e.g. "₹1,200 due")
  data?: any;        // full record handed back to onChange as `meta`
};

export function Combobox({
  value, onChange, search, onCreate, createHint,
  placeholder, inputStyle, minChars = 2, autoFocus, emptyText, disabled,
}: {
  value: string;
  onChange: (value: string, meta?: any) => void;
  search: (q: string) => Promise<ComboOption[]>;
  onCreate?: (text: string) => Promise<ComboOption | null>;
  createHint?: (text: string) => string;
  placeholder?: string;
  inputStyle?: React.CSSProperties;
  minChars?: number;
  autoFocus?: boolean;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);          // creating
  const [err, setErr] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Refs so we never re-run the search effect just because the host passed a
  // fresh inline closure, and so a programmatic value set (pick/create) doesn't
  // immediately re-search the value we just chose.
  const searchRef = useRef(search);  searchRef.current = search;
  const createRef = useRef(onCreate); createRef.current = onCreate;
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const q = value.trim();
    if (q.length < minChars) { setOpts([]); setErr(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true); setErr(null);
      try {
        const r = await searchRef.current(q);
        if (alive) { setOpts(r); setHi(0); }
      } catch (e: any) {
        if (alive) { setErr(e?.message || 'Search failed'); setOpts([]); }
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [value, minChars]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function choose(o: ComboOption) {
    skip.current = true;
    onChange(o.value, o.data ?? null);
    setOpen(false);
    setOpts([]);
  }

  async function create() {
    if (!createRef.current) return;
    const text = value.trim();
    if (text.length < minChars) return;
    setBusy(true); setErr(null);
    try {
      const o = await createRef.current(text);
      if (o) {
        skip.current = true;
        onChange(o.value, o.data ?? null);
        setOpen(false);
        setOpts([]);
      }
    } catch (e: any) {
      setErr(e?.message || 'Could not add');
    } finally { setBusy(false); }
  }

  const q = value.trim();
  const exact = opts.some(o => o.value.toLowerCase() === q.toLowerCase());
  const canCreate = !!onCreate && q.length >= minChars && !exact && !loading && !busy;
  const showPanel = open && q.length >= minChars;

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showPanel) return;
    const n = opts.length + (canCreate ? 1 : 0);
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, Math.max(0, n - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      if (hi < opts.length && opts[hi]) { e.preventDefault(); choose(opts[hi]); }
      else if (canCreate && hi >= opts.length) { e.preventDefault(); create(); }
    } else if (e.key === 'Escape') { setOpen(false); }
  }

  const createIdx = opts.length;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        autoComplete="off"
        style={{ ...defInput, ...inputStyle }}
      />

      {showPanel && (
        <div style={panel}>
          {loading && <div style={muted}>Searching…</div>}
          {!loading && err && <div style={{ ...muted, color: 'var(--rust, #B5483D)' }}>{err}</div>}
          {!loading && !err && opts.length === 0 && !canCreate && (
            <div style={{ ...muted, fontStyle: 'italic' }}>{emptyText || `Nothing matches “${q}”.`}</div>
          )}
          {!loading && !err && opts.map((o, i) => {
            const on = i === hi;
            return (
              <button
                key={`${o.value}-${i}`}
                type="button"
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(o)}
                style={{ ...row, background: on ? 'var(--bg-2, #f6f8fb)' : 'transparent' }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={rowMain}>{o.label}</div>
                  {o.sub && <div style={rowSub}>{o.sub}</div>}
                </div>
                {o.right && <div style={rowRight}>{o.right}</div>}
              </button>
            );
          })}
          {canCreate && (
            <button
              type="button"
              onMouseEnter={() => setHi(createIdx)}
              onClick={create}
              disabled={busy}
              style={{
                ...row,
                background: hi === createIdx ? 'var(--bg-2, #f6f8fb)' : 'transparent',
                borderTop: opts.length ? '1px solid rgba(15,40,85,0.06)' : 'none',
                color: 'var(--navy, #1A3F7E)', fontWeight: 700,
              }}
            >
              {busy ? 'Adding…' : (createHint ? createHint(q) : `+ Add “${q}”`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const defInput: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '10px 12px',
  border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
  outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff',
};
const panel: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 50,
  background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 10,
  boxShadow: '0 14px 40px rgba(15,40,85,0.18)', maxHeight: 320, overflowY: 'auto',
};
const muted: React.CSSProperties = { padding: '12px 14px', fontSize: 12.5, color: 'var(--t-3)' };
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
  padding: '9px 13px', border: 'none', borderBottom: '1px solid rgba(15,40,85,0.05)',
  cursor: 'pointer', fontFamily: 'inherit',
};
const rowMain: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--navy-deep)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const rowSub: React.CSSProperties = {
  fontSize: 11, color: 'var(--ink-soft, #6b7488)', marginTop: 2,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const rowRight: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--rust, #B5483D)',
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
};
