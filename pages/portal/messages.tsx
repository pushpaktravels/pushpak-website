// ============================================================
// /portal/messages — internal exec chat (1-to-1 + group).
// ============================================================
// Left: your conversations + "New chat". Right: the open thread with
// a composer. Polls the list every 15s and the open thread every 6s
// while the tab is visible. Opening a thread marks it read (clears the
// bell badge for its messages). Deep-linkable via ?c=<conversationId>
// from a notification click.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AppShell } from '../../components/AppShell';
import { MentionTextarea } from '../../components/MentionTextarea';

type Member = { id: string; execId: string; name: string };
type Conversation = {
  id: string; isGroup: boolean; title: string; members: Member[];
  lastMessageAt: string; preview: string | null; unread: number;
};
type Msg = { id: string; senderId: string; senderName: string; body: string; createdAt: string };
type PickUser = { id: string; execId: string; name: string; role: string; badge: string };

export default function MessagesPage() {
  const router = useRouter();
  const [meId, setMeId] = useState<string | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<{ title: string; isGroup: boolean; members: Member[]; messages: Msg[] } | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const [showPicker, setShowPicker] = useState(false);
  const [users, setUsers] = useState<PickUser[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState('');
  const [pickerFilter, setPickerFilter] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadConvs = useCallback(async () => {
    try {
      const r = await fetch('/api/messages').then(x => x.json());
      if (r?.ok) setConvs(r.conversations);
    } catch {/* silent */}
  }, []);

  const loadThread = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/messages/${id}`).then(x => x.json());
      if (r?.ok) {
        setThread({ title: r.conversation.title, isGroup: r.conversation.isGroup, members: r.conversation.members, messages: r.messages });
        // Opening marks it read — reflect that in the list immediately.
        setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c));
      }
    } catch {/* silent */}
  }, []);

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(r => { if (r?.ok) setMeId(r.user.id); }).catch(() => {});
    loadConvs();
  }, [loadConvs]);

  // Deep-link: ?c=<id> selects a conversation.
  useEffect(() => {
    const c = router.query.c;
    if (typeof c === 'string' && c) setSelected(c);
  }, [router.query.c]);

  // Load + poll the open thread.
  useEffect(() => {
    if (!selected) { setThread(null); return; }
    loadThread(selected);
    const id = setInterval(() => { if (!document.hidden) loadThread(selected); }, 6000);
    return () => clearInterval(id);
  }, [selected, loadThread]);

  // Poll the conversation list.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) loadConvs(); }, 15000);
    return () => clearInterval(id);
  }, [loadConvs]);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length, selected]);

  async function openPicker() {
    setShowPicker(true);
    setPicked(new Set());
    setGroupTitle('');
    setPickerFilter('');
    if (users.length === 0) {
      const r = await fetch('/api/messages/users').then(x => x.json());
      if (r?.ok) setUsers(r.users);
    }
  }

  function togglePick(id: string) {
    setPicked(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function startChat() {
    const userIds = Array.from(picked);
    if (userIds.length === 0) return;
    const r = await fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds, title: userIds.length > 1 ? (groupTitle.trim() || undefined) : undefined }),
    }).then(x => x.json());
    if (r?.ok) {
      setShowPicker(false);
      await loadConvs();
      setSelected(r.conversationId);
    }
  }

  async function sendMsg() {
    const body = text.trim();
    if (!body || !selected || sending) return;
    setSending(true);
    setText('');
    try {
      const r = await fetch(`/api/messages/${selected}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }).then(x => x.json());
      if (r?.ok) { await loadThread(selected); loadConvs(); }
      else setText(body); // restore on failure
    } catch { setText(body); }
    finally { setSending(false); }
  }

  const filteredUsers = users.filter(u =>
    !pickerFilter || u.name.toLowerCase().includes(pickerFilter.toLowerCase()) || u.execId.toLowerCase().includes(pickerFilter.toLowerCase())
  );

  return (
    <AppShell title="Messages" crumb="Personal · Chat">
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 4px 24px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16,
          height: 'calc(100vh - 160px)', minHeight: 480,
        }}>
          {/* ── Conversation list ───────────────────────────── */}
          <div style={{
            background: '#fff', border: '1px solid rgba(15,40,85,0.10)', borderRadius: 12,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(15,40,85,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-soft, #475569)' }}>Chats</div>
              <button onClick={openPicker} style={{
                marginLeft: 'auto', background: 'var(--navy-deep, #0F2855)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>+ New chat</button>
            </div>
            <div className="scroll" style={{ overflowY: 'auto', flex: 1 }}>
              {convs.length === 0 && (
                <div style={{ padding: 22, color: 'var(--ink-soft)', fontSize: 12.5, textAlign: 'center', fontStyle: 'italic' }}>
                  No conversations yet. Start one with “New chat”.
                </div>
              )}
              {convs.map(c => (
                <button key={c.id} onClick={() => setSelected(c.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px',
                  background: c.id === selected ? 'rgba(15,40,85,0.06)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(15,40,85,0.05)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink, #0F2855)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.isGroup ? '👥 ' : ''}{c.title}
                    </span>
                    {c.unread > 0 && (
                      <span style={{
                        minWidth: 18, height: 18, padding: '0 5px', background: 'var(--rust, #B5483D)', color: '#fff',
                        borderRadius: 999, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{c.unread}</span>
                    )}
                  </div>
                  {c.preview && (
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.preview}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Thread ──────────────────────────────────────── */}
          <div style={{
            background: '#fff', border: '1px solid rgba(15,40,85,0.10)', borderRadius: 12,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {!selected || !thread ? (
              <div style={{ margin: 'auto', color: 'var(--ink-soft)', fontSize: 13, fontStyle: 'italic' }}>
                Select a conversation, or start a new one.
              </div>
            ) : (
              <>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(15,40,85,0.08)' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink, #0F2855)' }}>
                    {thread.isGroup ? '👥 ' : ''}{thread.title}
                  </div>
                  {thread.isGroup && (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                      {thread.members.map(m => m.name).join(', ')}
                    </div>
                  )}
                </div>
                <div ref={scrollRef} className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', background: 'rgba(15,40,85,0.02)' }}>
                  {thread.messages.length === 0 && (
                    <div style={{ color: 'var(--ink-soft)', fontSize: 12.5, textAlign: 'center', fontStyle: 'italic', marginTop: 20 }}>
                      No messages yet. Say hello.
                    </div>
                  )}
                  {thread.messages.map(m => {
                    const mine = m.senderId === meId;
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                        <div style={{ maxWidth: '72%' }}>
                          {thread.isGroup && !mine && (
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gold-deep, #B58430)', marginBottom: 2, paddingLeft: 4 }}>{m.senderName}</div>
                          )}
                          <div style={{
                            padding: '9px 13px', borderRadius: 12,
                            background: mine ? 'var(--navy-deep, #0F2855)' : '#fff',
                            color: mine ? '#fff' : 'var(--ink, #0F2855)',
                            border: mine ? 'none' : '1px solid rgba(15,40,85,0.10)',
                            fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>{m.body}</div>
                          <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 3, textAlign: mine ? 'right' : 'left', paddingInline: 4 }}>
                            {new Date(m.createdAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: 12, borderTop: '1px solid rgba(15,40,85,0.08)', display: 'flex', gap: 8 }}>
                  <MentionTextarea
                    value={text}
                    onChange={setText}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                    placeholder="Type a message…  (Enter to send, Shift+Enter for a new line, @ to tag)"
                    rows={1}
                    style={{
                      flex: 1, resize: 'none', fontFamily: 'inherit', fontSize: 13.5, padding: '10px 12px',
                      border: '1px solid rgba(15,40,85,0.14)', borderRadius: 8, outline: 'none', color: 'var(--ink, #0F2855)',
                      maxHeight: 120,
                    }}
                  />
                  <button onClick={sendMsg} disabled={sending || !text.trim()} style={{
                    background: 'var(--navy-deep, #0F2855)', color: '#fff', border: 'none', borderRadius: 8,
                    padding: '0 18px', fontSize: 13, fontWeight: 700, cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
                    opacity: sending || !text.trim() ? 0.6 : 1, fontFamily: 'inherit',
                  }}>Send</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── New-chat picker modal ───────────────────────────── */}
      {showPicker && (
        <div onClick={() => setShowPicker(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(8,24,58,0.45)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 'min(460px, 96vw)', maxHeight: '82vh', background: '#fff', borderRadius: 14,
            boxShadow: '0 24px 64px rgba(8,24,58,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(15,40,85,0.08)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink, #0F2855)' }}>New chat</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>Pick one person for a direct chat, or several for a group.</div>
            </div>
            <div style={{ padding: '12px 20px 0' }}>
              <input value={pickerFilter} onChange={e => setPickerFilter(e.target.value)} placeholder="Search people…" style={{
                width: '100%', fontSize: 13, padding: '9px 12px', border: '1px solid rgba(15,40,85,0.14)', borderRadius: 8,
                outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', color: 'var(--ink)',
              }} />
            </div>
            <div className="scroll" style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
              {filteredUsers.map(u => (
                <label key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                  background: picked.has(u.id) ? 'rgba(15,40,85,0.06)' : 'transparent',
                }}>
                  <input type="checkbox" checked={picked.has(u.id)} onChange={() => togglePick(u.id)} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink, #0F2855)' }}>{u.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginLeft: 'auto' }}>{u.badge}</span>
                </label>
              ))}
              {filteredUsers.length === 0 && (
                <div style={{ padding: 18, color: 'var(--ink-soft)', fontSize: 12.5, textAlign: 'center', fontStyle: 'italic' }}>No one found.</div>
              )}
            </div>
            {picked.size > 1 && (
              <div style={{ padding: '0 20px 8px' }}>
                <input value={groupTitle} onChange={e => setGroupTitle(e.target.value)} placeholder="Group name (optional)" style={{
                  width: '100%', fontSize: 13, padding: '9px 12px', border: '1px solid rgba(15,40,85,0.14)', borderRadius: 8,
                  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', color: 'var(--ink)',
                }} />
              </div>
            )}
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(15,40,85,0.08)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowPicker(false)} style={{
                background: 'transparent', border: '1px solid rgba(15,40,85,0.14)', borderRadius: 8, padding: '9px 16px',
                fontSize: 13, color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
              <button onClick={startChat} disabled={picked.size === 0} style={{
                background: 'var(--navy-deep, #0F2855)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px',
                fontSize: 13, fontWeight: 700, cursor: picked.size === 0 ? 'not-allowed' : 'pointer', opacity: picked.size === 0 ? 0.6 : 1, fontFamily: 'inherit',
              }}>{picked.size > 1 ? 'Start group' : 'Start chat'}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
