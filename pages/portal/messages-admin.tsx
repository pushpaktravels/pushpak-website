// ============================================================
// /portal/messages-admin — OWNER-ONLY chat oversight (Vanshika).
// ============================================================
// Read-only view of every conversation in the portal. Reads go through
// /api/messages/admin, which never writes read-state or notifications —
// so observing a chat leaves no trace the participants could notice.
// The page is reachable only from the owner's nav; any non-owner who
// guesses the URL gets an empty "not authorised" state from the API.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Member = { id: string; execId: string; name: string };
type ConvRow = {
  id: string; isGroup: boolean; title: string; members: Member[];
  messageCount: number; lastMessageAt: string; preview: string | null;
};
type Msg = { id: string; senderId: string; senderName: string; senderExecId: string; body: string; createdAt: string };

export default function MessagesAdminPage() {
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ members: Member[]; messages: Msg[] } | null>(null);
  const [denied, setDenied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/messages/admin').then(r => r.json()).then(r => {
      if (r?.ok) setConvs(r.conversations);
      else setDenied(true);
      setLoaded(true);
    }).catch(() => { setDenied(true); setLoaded(true); });
  }, []);

  useEffect(() => {
    if (!selected) { setTranscript(null); return; }
    fetch(`/api/messages/admin?conversationId=${encodeURIComponent(selected)}`).then(r => r.json()).then(r => {
      if (r?.ok) setTranscript({ members: r.members, messages: r.messages });
    }).catch(() => {});
  }, [selected]);

  if (loaded && denied) {
    return (
      <AppShell title="Message Oversight" crumb="Governance">
        <div style={{ padding: 32, color: 'var(--rust)' }}>Not authorised.</div>
      </AppShell>
    );
  }

  const filtered = convs.filter(c =>
    !filter || c.title.toLowerCase().includes(filter.toLowerCase()) ||
    c.members.some(m => m.name.toLowerCase().includes(filter.toLowerCase()) || m.execId.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <AppShell title="Message Oversight" crumb="Governance · Private">
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 4px 24px' }}>
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(217,165,69,0.08)', border: '1px dashed rgba(217,165,69,0.35)',
          fontSize: 12.5, color: 'var(--ink-soft, #475569)',
        }}>
          Private to you. This shows every conversation across the portal, read-only. Viewing a chat here is invisible to the people in it.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, height: 'calc(100vh - 210px)', minHeight: 460 }}>
          {/* All conversations */}
          <div style={{ background: '#fff', border: '1px solid rgba(15,40,85,0.10)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(15,40,85,0.08)' }}>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search by person or group…" style={{
                width: '100%', fontSize: 13, padding: '8px 11px', border: '1px solid rgba(15,40,85,0.14)', borderRadius: 8,
                outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', color: 'var(--ink)',
              }} />
            </div>
            <div className="scroll" style={{ overflowY: 'auto', flex: 1 }}>
              {filtered.length === 0 && (
                <div style={{ padding: 22, color: 'var(--ink-soft)', fontSize: 12.5, textAlign: 'center', fontStyle: 'italic' }}>
                  {convs.length === 0 ? 'No conversations yet.' : 'No matches.'}
                </div>
              )}
              {filtered.map(c => (
                <button key={c.id} onClick={() => setSelected(c.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px',
                  background: c.id === selected ? 'rgba(15,40,85,0.06)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(15,40,85,0.05)', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink, #0F2855)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.isGroup ? '👥 ' : ''}{c.title}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{c.messageCount} msg</span>
                  </div>
                  {c.preview && (
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</div>
                  )}
                  <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 3 }}>
                    {new Date(c.lastMessageAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Transcript */}
          <div style={{ background: '#fff', border: '1px solid rgba(15,40,85,0.10)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!transcript ? (
              <div style={{ margin: 'auto', color: 'var(--ink-soft)', fontSize: 13, fontStyle: 'italic' }}>Select a conversation to read it.</div>
            ) : (
              <>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(15,40,85,0.08)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Participants</div>
                  <div style={{ fontSize: 13.5, color: 'var(--ink, #0F2855)', marginTop: 3 }}>
                    {transcript.members.map(m => m.name).join(', ')}
                  </div>
                </div>
                <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', background: 'rgba(15,40,85,0.02)' }}>
                  {transcript.messages.length === 0 && (
                    <div style={{ color: 'var(--ink-soft)', fontSize: 12.5, textAlign: 'center', fontStyle: 'italic', marginTop: 20 }}>No messages.</div>
                  )}
                  {transcript.messages.map(m => (
                    <div key={m.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gold-deep, #B58430)' }}>{m.senderName}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>
                          {new Date(m.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                      <div style={{ fontSize: 13.5, color: 'var(--ink, #0F2855)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>{m.body}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
