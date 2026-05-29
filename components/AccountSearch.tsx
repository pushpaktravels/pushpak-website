// ============================================================
// AccountSearch — reusable typeahead for finding any account.
// ============================================================
// Drop this at the top of a list page (Team Worklist, Families,
// Worklist, Promises, Doubtful, Legal, Collections, …). The user
// types a party or family name, a dropdown of matching accounts
// appears below the input, and clicking one fires `onSelect(id)`
// which the host page wires to setOpenId so the AccountDrawer
// pops open.
//
// Hits the same /api/hold-check endpoint that powers Hold Check.
// Debounced 250ms. Closes on outside click, Esc, or selection.
// Arrow keys navigate, Enter selects.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { TierBadge } from './TierBadge';
import { fmtINR } from '../lib/fmt';

type Row = {
  id: string;
  party: string;
  family: string | null;
  exec: string | null;
  bill: string | number;
  tier: string;
  onHold: string | null;
};

export function AccountSearch({
  onSelect,
  placeholder = 'Search any party or family by name…',
  label = 'Quick find',
}: {
  onSelect: (id: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced search — same endpoint as Hold Check.
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); setError(null); return; }
    const t = setTimeout(() => {
      setLoading(true); setError(null);
      fetch(`/api/hold-check?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json())
        .then(r => {
          if (!r?.ok) throw new Error(r?.error || 'Search failed');
          setRows((r.data || []).slice(0, 12));
          setHighlight(0);
        })
        .catch(e => { setError(e.message); setRows([]); })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function choose(r: Row) {
    setOpen(false);
    setQ('');
    setRows([]);
    onSelect(r.id);
    // Refocus so a second lookup is instant.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || rows.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); const r = rows[highlight]; if (r) choose(r); }
    else if (e.key === 'Escape')    { setOpen(false); }
  }

  const showDropdown = open && q.trim().length >= 2;

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginBottom: 18 }}>
      <div style={{
        background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
        borderRadius: 12, padding: '14px 16px',
      }}>
        <label style={{
          display: 'block', fontSize: 10, letterSpacing: '.22em',
          textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6,
        }}>{label}</label>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          style={{
            width: '100%', fontSize: 14, padding: '10px 12px',
            border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
            outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit',
          }}
        />
      </div>

      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          marginTop: 4, zIndex: 30,
          background: '#fff',
          border: '1px solid var(--line, #e7eaf0)',
          borderRadius: 10,
          boxShadow: '0 14px 40px rgba(15,40,85,0.18)',
          maxHeight: 380, overflowY: 'auto',
        }}>
          {loading && (
            <div style={{ padding: 14, fontSize: 12.5, color: 'var(--t-3)' }}>Searching…</div>
          )}
          {!loading && error && (
            <div style={{ padding: 14, fontSize: 12.5, color: 'var(--rust)' }}>{error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div style={{ padding: 14, fontSize: 12.5, color: 'var(--t-3)', fontStyle: 'italic' }}>
              No party or family contains "{q}".
            </div>
          )}
          {!loading && !error && rows.length > 0 && rows.map((r, i) => {
            const isHi = i === highlight;
            return (
              <button
                key={r.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(r)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr auto',
                  alignItems: 'center', gap: 12,
                  width: '100%', textAlign: 'left',
                  padding: '10px 14px',
                  background: isHi ? 'var(--bg-2, #f6f8fb)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(15,40,85,0.05)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <TierBadge tier={r.tier} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--navy-deep)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{r.party}</div>
                  <div style={{
                    fontSize: 11, color: 'var(--ink-soft)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {r.family || 'No family'}{r.exec ? ` · ${r.exec}` : ''}
                    {r.onHold ? ` · ${r.onHold} hold` : ''}
                  </div>
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--navy-deep)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{fmtINR(Number(r.bill))}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
