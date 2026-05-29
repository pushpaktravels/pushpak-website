// ============================================================
// NotificationsBell — bell icon with unread count + dropdown panel.
// ============================================================
// Mounted in the Header. Polls /api/notifications every 60s while
// the page is visible. Click the bell → small dropdown panel lists
// recent unread items; clicking a row marks it read and (if it has
// an accountId or party) opens the corresponding drawer.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

type Notif = {
  id: string; ts: string; kind: string;
  title: string; body: string | null;
  party: string | null; accountId: string | null;
  convId: string | null;
  readAt: string | null;
};

export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/notifications').then(x => x.json());
      if (r?.ok) {
        setRows(r.rows || []);
        setUnread(r.unread || 0);
      }
    } catch {/* silent */}
  }
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markAllRead() {
    await fetch('/api/notifications/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    await load();
  }
  async function open1(n: Notif) {
    await fetch('/api/notifications/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [n.id] }),
    });
    setOpen(false);
    if (n.kind === 'MESSAGE') router.push(`/portal/messages${n.convId ? `?c=${n.convId}` : ''}`);
    else if (n.party) router.push(`/portal/worklist`);
    load();
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        style={{ position: 'relative' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 16, height: 16, padding: '0 4px',
            background: 'var(--rust, #B5483D)', color: '#fff',
            borderRadius: 999, fontSize: 9.5, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,.18)',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 900,
          width: 360, maxHeight: 480, overflow: 'hidden',
          background: '#fff', border: '1px solid rgba(15,40,85,0.12)',
          borderRadius: 12, boxShadow: '0 18px 48px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: '1px solid rgba(15,40,85,0.08)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink, #0F2855)' }}>Notifications</div>
            <span style={{ fontSize: 11, color: 'var(--ink-soft, #475569)' }}>{unread} unread</span>
            <button onClick={markAllRead} style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: 'var(--gold-deep, #B58430)', cursor: 'pointer',
              fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
              fontFamily: 'inherit',
            }}>Mark all read</button>
          </div>
          <div style={{ overflowY: 'auto' }}>
            {rows.length === 0 && (
              <div style={{ padding: 22, color: 'var(--ink-soft)', fontSize: 12.5, textAlign: 'center', fontStyle: 'italic' }}>
                Nothing here yet.
              </div>
            )}
            {rows.map(n => (
              <button key={n.id} onClick={() => open1(n)} style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '12px 16px',
                background: n.readAt ? 'transparent' : 'rgba(15,40,85,0.04)',
                border: 'none', borderBottom: '1px solid rgba(15,40,85,0.05)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
                    color: n.readAt ? 'var(--ink-soft)' : 'var(--gold-deep, #B58430)',
                  }}>{n.kind}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{fmtRel(n.ts)}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink, #0F2855)', fontWeight: 600, marginTop: 4 }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtRel(ts: string): string {
  const d = +new Date() - +new Date(ts);
  const mins = Math.floor(d / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
