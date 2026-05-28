// ============================================================
// SendReminder — WhatsApp reminder picker.
// ============================================================
// Renders a small button. Click → fetches templates (once, cached
// at module scope) → opens a centred picker modal with 5 reminder
// types. Pick one → message is rendered with variables substituted
// → opens wa.me/<phone>?text=<msg> in a new tab AND posts to
// /api/whatsapp/log so the send appears in the Timeline.
//
// Variables:
//   {party}        — account name
//   {outstanding}  — formatted INR amount
//   {owner}        — owner / contact person from ClientMaster, or 'Sir/Madam'
//   {days}         — days overdue (max 999)
//   {exec}         — current user.name
// ============================================================
import { useEffect, useState } from 'react';

type Template = { key: string; label: string; tone: 'sage' | 'amber' | 'rust'; body: string };

type Props = {
  party: string;
  outstanding: number;
  daysOverdue?: number;
  owner?: string | null;       // contact owner from ClientMaster
  phone?: string | null;       // WhatsApp number (unmasked) — if absent, prompts
  execName?: string;           // logged-in user's name
  variant?: 'button' | 'icon';
  onSent?: () => void;
};

// Module-level cache so the modal opens fast on repeat invocations.
let cachedTemplates: Template[] | null = null;

export function SendReminder({
  party, outstanding, daysOverdue, owner, phone, execName, variant = 'button', onSent,
}: Props) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(cachedTemplates);
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [phoneNeeded, setPhoneNeeded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Two-step pick → preview → send flow.
  const [selected, setSelected] = useState<Template | null>(null);
  const [editedMessage, setEditedMessage] = useState<string>('');

  useEffect(() => {
    if (!open || templates) return;
    fetch('/api/whatsapp/templates')
      .then(r => r.json())
      .then(r => { if (r?.ok) { setTemplates(r.templates); cachedTemplates = r.templates; } })
      .catch(() => {});
  }, [open, templates]);

  // On modal open, if no phone was passed in, ask the reveal
  // endpoint for whatsapp → phone1. This single fetch writes an
  // audit row for the reveal (PII), then keeps the unmasked number
  // in local state for the rest of the modal's life.
  useEffect(() => {
    if (!open || phone || phoneInput) return;
    let cancelled = false;
    (async () => {
      for (const field of ['whatsapp', 'phone1'] as const) {
        try {
          const r = await fetch(`/api/clients/${encodeURIComponent(party)}/reveal`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field }),
          }).then(x => x.json());
          if (!cancelled && r?.ok && r.value) {
            setPhoneInput(r.value);
            return;
          }
        } catch { /* try next field */ }
      }
      if (!cancelled) setPhoneNeeded(true);
    })();
    return () => { cancelled = true; };
  }, [open, phone, party]);

  function render(body: string): string {
    return body
      .replaceAll('{party}',       party)
      .replaceAll('{outstanding}', new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(outstanding)))
      .replaceAll('{owner}',       owner || 'Sir/Madam')
      .replaceAll('{days}',        String(Math.min(daysOverdue ?? 0, 999)))
      .replaceAll('{exec}',        execName || 'Pushpak Travels');
  }

  function pick(tpl: Template) {
    // Step 1: select a template — show the rendered message in a
    // big readable box. The user re-reads it (and can edit if they
    // want) before hitting Send.
    setSelected(tpl);
    setEditedMessage(render(tpl.body));
    setErr(null);
  }

  async function send() {
    if (!selected) return;
    setErr(null);
    let target = (phone || '').replace(/\D/g, '');
    if (!target && phoneInput) target = phoneInput.replace(/\D/g, '');
    if (!target) { setPhoneNeeded(true); return; }
    if (target.length === 10) target = `91${target}`;     // assume India when bare 10-digit
    setBusy(selected.key);
    try {
      // Log first, then open — that way the audit reflects intent
      // even if the user closes the WA tab without sending.
      await fetch('/api/whatsapp/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party, template: selected.key, to: target, message: editedMessage }),
      }).then(x => x.json());
      window.open(`https://wa.me/${target}?text=${encodeURIComponent(editedMessage)}`, '_blank');
      onSent?.();
      setOpen(false);
      setSelected(null);
    } catch (e: any) {
      setErr(e.message || 'Failed to log');
    } finally {
      setBusy(null);
    }
  }

  // Reset selection when the modal closes
  useEffect(() => { if (!open) { setSelected(null); setEditedMessage(''); } }, [open]);

  return (
    <>
      {variant === 'icon' ? (
        <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} title="Send WhatsApp reminder" style={{
          background: 'rgba(46,108,84,0.10)', border: '1px solid rgba(46,108,84,0.32)',
          color: 'var(--sage, #2E6C54)', cursor: 'pointer',
          padding: '6px 10px', borderRadius: 6,
          fontSize: 10.5, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
          fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <WaIcon /> Send
        </button>
      ) : (
        <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} style={{
          background: 'linear-gradient(180deg,#3CB371,#2E6C54)', color: '#fff',
          border: 'none', cursor: 'pointer',
          padding: '10px 16px', borderRadius: 8,
          fontSize: 11, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase',
          fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8,
          boxShadow: '0 6px 18px rgba(46,108,84,0.25)',
        }}>
          <WaIcon /> Send Reminder
        </button>
      )}

      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(15,40,85,0.42)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--paper, #F8F4EC)', borderRadius: 14,
            width: '100%', maxWidth: 520,
            boxShadow: '0 30px 80px rgba(0,0,0,0.32)',
            display: 'flex', flexDirection: 'column', maxHeight: '92vh',
          }}>
            <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid rgba(15,40,85,0.10)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Send WhatsApp reminder</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                <b>{party}</b> · ₹{Math.round(outstanding).toLocaleString('en-IN')}
                {daysOverdue && daysOverdue > 0 ? ` · ${daysOverdue}d overdue` : ''}
              </div>
            </div>

            {(phoneNeeded || (!phone && !phoneInput)) && (
              <div style={{ padding: '14px 22px', borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
                <label style={{
                  display: 'block', fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase',
                  color: 'var(--ink-soft)', fontWeight: 700, marginBottom: 6,
                }}>WhatsApp number</label>
                <input
                  type="tel" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="98XXXXXXXX or +91 98XXX XXXXX"
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    border: '1px solid rgba(15,40,85,0.18)',
                    fontSize: 14, color: 'var(--ink)', background: '#fff',
                    fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
                  Tip: save this on the Contact tab so future reminders don't ask.
                </div>
              </div>
            )}

            {/* PICK step — list templates */}
            {!selected && (
              <div style={{ overflowY: 'auto', padding: '8px 0' }}>
                {!templates && <div style={{ padding: 18, color: 'var(--ink-soft)' }}>Loading templates…</div>}
                {templates && templates.map(t => (
                  <button key={t.key} onClick={() => pick(t)} disabled={busy === t.key}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '12px 22px',
                      background: busy === t.key ? 'rgba(15,40,85,0.06)' : 'transparent',
                      border: 'none', borderBottom: '1px solid rgba(15,40,85,0.04)',
                      cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
                        padding: '3px 8px', borderRadius: 4,
                        background: t.tone === 'rust' ? 'rgba(178,79,55,.16)' : t.tone === 'amber' ? 'rgba(217,165,69,.18)' : 'rgba(46,108,84,.14)',
                        color: t.tone === 'rust' ? 'var(--rust)' : t.tone === 'amber' ? 'var(--amber, #B58430)' : 'var(--sage, #2E6C54)',
                      }}>{t.label}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Click to preview</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5,
                                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {render(t.body)}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* PREVIEW step — full message in a box, editable, then Send */}
            {selected && (
              <div style={{ padding: '14px 22px 4px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
                    padding: '3px 8px', borderRadius: 4,
                    background: selected.tone === 'rust' ? 'rgba(178,79,55,.16)' : selected.tone === 'amber' ? 'rgba(217,165,69,.18)' : 'rgba(46,108,84,.14)',
                    color: selected.tone === 'rust' ? 'var(--rust)' : selected.tone === 'amber' ? 'var(--amber, #B58430)' : 'var(--sage, #2E6C54)',
                  }}>{selected.label}</span>
                  <button onClick={() => { setSelected(null); setEditedMessage(''); }} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--ink-soft)', fontSize: 10.5, fontWeight: 700,
                    letterSpacing: '.18em', textTransform: 'uppercase', fontFamily: 'inherit',
                  }}>← Pick another</button>
                </div>
                <label style={{
                  display: 'block', fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase',
                  color: 'var(--ink-soft)', fontWeight: 700, marginBottom: 6,
                }}>Message preview · edit if you like</label>
                <textarea
                  value={editedMessage}
                  onChange={e => setEditedMessage(e.target.value)}
                  rows={10}
                  style={{
                    width: '100%', minHeight: 200,
                    padding: '14px 16px', borderRadius: 10,
                    border: '1px solid rgba(15,40,85,0.18)',
                    background: '#fff', color: 'var(--ink, #0F2855)',
                    fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.65,
                    outline: 'none', resize: 'vertical', whiteSpace: 'pre-wrap',
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-soft)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{editedMessage.length} characters</span>
                  <span>WhatsApp will open with this message pre-filled</span>
                </div>
              </div>
            )}

            {err && <div style={{ padding: '10px 22px', color: 'var(--rust)', fontSize: 12 }}>{err}</div>}

            <div style={{
              padding: '12px 22px', borderTop: '1px solid rgba(15,40,85,0.10)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                {selected ? 'Sending logs to Timeline + opens WhatsApp Web.' : 'Pick a template to preview the message.'}
              </div>
              <button onClick={() => setOpen(false)} style={{
                marginLeft: 'auto', padding: '8px 14px', borderRadius: 6,
                background: 'transparent', color: 'var(--ink-soft)',
                border: '1px solid rgba(15,40,85,0.22)',
                fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
              {selected && (
                <button onClick={send} disabled={!!busy || !editedMessage.trim()} style={{
                  padding: '10px 18px', borderRadius: 6,
                  background: busy ? 'rgba(15,40,85,0.25)' : 'linear-gradient(180deg,#3CB371,#2E6C54)',
                  color: '#fff', border: 'none',
                  fontSize: 11, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase',
                  cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  {busy ? 'Sending…' : 'Send via WhatsApp →'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.5 14.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2s-.8 1-1 1.2c-.2.2-.3.2-.6.1-1.8-.9-3-1.7-4.2-3.7-.3-.5.3-.5.9-1.6.1-.2.1-.4 0-.5l-1-2.3c-.2-.4-.4-.4-.6-.4h-.6c-.2 0-.5.1-.7.4-.2.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.9 2.9 4.5 4 .6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.5-.4zM12 22c-1.7 0-3.4-.4-4.9-1.3L2 22l1.4-5c-1-1.6-1.4-3.2-1.4-5C2 6.5 6.5 2 12 2s10 4.5 10 10-4.5 10-10 10z"/>
    </svg>
  );
}
