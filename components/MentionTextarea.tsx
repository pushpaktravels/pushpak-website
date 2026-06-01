// ============================================================
// MentionTextarea — a <textarea> with @name autocomplete.
// ============================================================
// Drop-in replacement for a plain textarea in the comment box and the
// chat composer. As you type "@" followed by letters, a dropdown of
// active staff appears; picking one inserts the person's FULL name
// (e.g. "@AMIT CHAKRABORTY ") so the backend mention-parser matches a
// real user and fires their notification.
//
// • onKeyDown is passed through ONLY when the dropdown is closed, so the
//   chat composer's "Enter to send" still works — but Enter picks the
//   highlighted name while the dropdown is open.
// • The staff list is fetched once from /api/messages/users and cached
//   at module scope so every box shares one request.
// ============================================================
import { useEffect, useRef, useState } from 'react';

type MUser = { name: string };

let _cache: MUser[] | null = null;
let _inflight: Promise<MUser[]> | null = null;
function loadUsers(): Promise<MUser[]> {
  if (_cache) return Promise.resolve(_cache);
  if (!_inflight) {
    _inflight = fetch('/api/messages/users')
      .then(r => r.json())
      .then(r => (r?.ok && Array.isArray(r.users) ? r.users.map((u: any) => ({ name: String(u.name) })) : []))
      .catch(() => [])
      .then(list => { _cache = list; return list; });
  }
  return _inflight;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onKeyDown'>;

export function MentionTextarea({ value, onChange, onKeyDown, style, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [users, setUsers] = useState<MUser[]>(_cache || []);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);

  useEffect(() => { loadUsers().then(setUsers); }, []);

  const matches = open
    ? users.filter(u => u.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : [];

  // Look at the text just before the caret; if it ends with "@" + letters
  // (at start or after a space), open the dropdown filtered by those letters.
  function sync() {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([a-zA-Z]*)$/);
    if (m) { setQ(m[1]); setOpen(true); setHi(0); }
    else { setOpen(false); }
  }

  function pick(name: string) {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const cur = el?.value ?? value;
    const before = cur.slice(0, caret).replace(/@([a-zA-Z]*)$/, `@${name} `);
    const after = cur.slice(caret);
    const next = before + after;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      if (el) { const pos = before.length; el.focus(); el.setSelectionRange(pos, pos); }
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % matches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hi].name); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setOpen(false); return; }
    }
    onKeyDown?.(e);
  }

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); sync(); }}
        onClick={sync}
        onKeyUp={e => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') sync(); }}
        onKeyDown={handleKey}
        onBlur={() => { setTimeout(() => setOpen(false), 120); }}
        style={style}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          minWidth: 180, maxWidth: 280, maxHeight: 220, overflowY: 'auto',
          background: '#fff', border: '1px solid rgba(15,40,85,0.16)', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(8,24,58,0.22)', zIndex: 1200, padding: 4,
        }}>
          {matches.map((u, idx) => (
            <div
              key={u.name}
              onMouseDown={e => { e.preventDefault(); pick(u.name); }}
              onMouseEnter={() => setHi(idx)}
              style={{
                padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                fontSize: 13, color: 'var(--ink, #0F2855)',
                background: idx === hi ? 'rgba(15,40,85,0.08)' : 'transparent',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              @{u.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
