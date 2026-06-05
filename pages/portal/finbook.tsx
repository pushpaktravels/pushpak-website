// ============================================================
// /portal/finbook — FinBook console: live client ledger + credit limit.
// ============================================================
// The first FinBook vertical: look up any client and see their live
// statement and sanctioned/available credit — inside the portal, no
// separate FinBook login. Read-only.
//
// Search is by CLIENT NAME (auto-focused, autocompletes from our debtor
// accounts). The FinBook code ("CCA…") is auto-detected: once it's been
// confirmed for a client it's remembered, so picking the name fills the
// code and runs the lookup with zero typing. First time for a client, the
// operator enters the code once and we offer to remember it.
//
// Until Calico unblocks our server IP the integration runs in DRY-RUN: the
// numbers are clearly badged "Simulated" so no one acts on them. The moment
// FINBOOK_MODE flips to 'live' the same screen shows real data.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtINR } from '../../lib/fmt';

// Default window = the running Indian financial year (1 Apr → today).
function fyStart(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; // Apr = month 3
  return `${y}-04-01`;
}
const todayStr = () => new Date().toISOString().slice(0, 10);

type Line = { date: string; docType: string; docNo: string; narration: string; debit: number; credit: number; balance: number; refKey?: string };
type Ledger = { clientId: string; clientName?: string; opening: number; closing: number; lines: Line[] };
type Limit = { clientId: string; creditLimit: number; outstanding: number; available: number; currency: string } | null;
type Resp = { mode: string; simulated: boolean; data: { ledger: Ledger; limit: Limit; limitError: string | null } };
type ClientHit = { party: string; family: string | null; finbookClientId: string | null; outstanding: number };

export default function FinbookPage() {
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayStr());
  const [resp, setResp] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Name autocomplete state ──
  const [name, setName] = useState('');
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [openList, setOpenList] = useState(false);
  // The client we picked by name, so we can remember the code we looked up.
  const [picked, setPicked] = useState<ClientHit | null>(null);
  const [savedCode, setSavedCode] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus the name search on load — "the search bar should fill
  // automatically": the operator can start typing a client name immediately.
  useEffect(() => { nameRef.current?.focus(); }, []);

  // Debounced name → suggestions.
  useEffect(() => {
    const q = name.trim();
    if (q.length < 2) { setHits([]); return; }
    // If the box exactly matches the client we already picked, don't reopen.
    if (picked && q === picked.party) return;
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/finbook/clients?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(r => { if (alive && r?.ok) { setHits(r.clients || []); setOpenList(true); } })
        .catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  function pickClient(c: ClientHit) {
    setPicked(c);
    setName(c.party);
    setHits([]); setOpenList(false);
    setSavedCode(false);
    if (c.finbookClientId) {
      // Code already known → fill it and look up straight away.
      setClientId(c.finbookClientId);
      lookup(undefined, c.finbookClientId);
    } else {
      // Unknown code — let the operator type it once; we'll offer to remember.
      setClientId('');
      setError(null); setResp(null);
    }
  }

  async function lookup(e?: React.FormEvent, idOverride?: string) {
    e?.preventDefault();
    const id = (idOverride ?? clientId).trim();
    if (!id) return;
    if (from && to && from > to) { setError('“From” date is after “To” date.'); return; }
    setLoading(true); setError(null); setResp(null); setSavedCode(false);
    try {
      const qs = new URLSearchParams({ clientId: id });
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const r = await fetch(`/api/finbook/account?${qs.toString()}`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Lookup failed');
      setResp(r as Resp);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Offer to remember the code we just used for the client we picked by name,
  // so next time picking the name fills it automatically.
  async function rememberCode() {
    if (!picked) return;
    const code = clientId.trim().toUpperCase();
    if (!code) return;
    try {
      const r = await fetch('/api/finbook/clients', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party: picked.party, finbookClientId: code }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Could not save');
      setPicked({ ...picked, finbookClientId: code });
      setSavedCode(true);
    } catch (e: any) { setError(e.message); }
  }

  const dryrun = resp?.mode === 'dryrun' || resp?.simulated;
  // Show the "remember" prompt when we picked a client by name, have a code
  // entered + looked up, and that code isn't already the remembered one.
  const offerRemember = !!picked && !!resp && clientId.trim().length > 0
    && picked.finbookClientId?.toUpperCase() !== clientId.trim().toUpperCase();

  return (
    <AppShell title="FinBook" crumb="FinBook">
      <div style={{ maxWidth: 760, marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>FinBook</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
          Search a client by <strong>name</strong> — we auto-detect their FinBook code.
          Look up their live ledger and credit limit without leaving the portal.
        </p>
      </div>

      {/* Mode banner */}
      {resp && (
        <div style={dryrun ? bannerSim : bannerLive}>
          {dryrun
            ? 'DRY-RUN — these figures are SIMULATED for testing. FinBook live access is not yet enabled, so do not act on these numbers.'
            : 'LIVE — figures are read directly from FinBook.'}
        </div>
      )}

      {/* Lookup */}
      <form onSubmit={lookup} style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Client name autocomplete */}
        <div style={{ position: 'relative', minWidth: 280 }}>
          <label style={fieldLbl}>Client name</label>
          <input
            ref={nameRef}
            value={name}
            onChange={e => { setName(e.target.value); setPicked(null); }}
            onFocus={() => { if (hits.length) setOpenList(true); }}
            onBlur={() => setTimeout(() => setOpenList(false), 150)}
            placeholder="Start typing a client name…"
            autoComplete="off"
            style={{ ...inputStyle, maxWidth: 320 }}
          />
          {openList && hits.length > 0 && (
            <div style={dropdown}>
              {hits.map((c) => (
                <button type="button" key={c.party} onMouseDown={e => { e.preventDefault(); pickClient(c); }} style={hitRow}>
                  <span style={{ fontWeight: 600, color: 'var(--navy-deep)' }}>{c.party}</span>
                  {c.family && c.family !== c.party && <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 6 }}>· {c.family}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700 }}>
                    {c.finbookClientId
                      ? <span style={{ color: 'var(--sage, #2E7D4F)' }}>{c.finbookClientId}</span>
                      : <span style={{ color: 'var(--t-3)' }}>no code yet</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* FinBook code — auto-filled from the name; editable for first-time / power use */}
        <div>
          <label style={fieldLbl}>FinBook code</label>
          <input
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="CCA000001"
            style={{ ...inputStyle, maxWidth: 160 }}
          />
        </div>

        <label style={dateLbl}>From
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
        </label>
        <label style={dateLbl}>To
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
        </label>
        <button type="submit" disabled={loading || !clientId.trim()} style={addBtn}>
          {loading ? 'LOADING…' : 'LOOK UP'}
        </button>
      </form>

      {/* First-time hint: picked a name with no code yet */}
      {picked && !picked.finbookClientId && !savedCode && (
        <div style={{ ...bannerSim, color: '#1A6FA8', background: 'rgba(26,111,168,.08)', border: '1px solid rgba(26,111,168,.25)' }}>
          No FinBook code saved for <strong>{picked.party}</strong> yet. Enter it once above and look up — you can then remember it for next time.
        </div>
      )}

      {/* Offer to remember the code just used */}
      {offerRemember && (
        <div style={rememberBox}>
          <span>Remember <strong>{clientId.trim().toUpperCase()}</strong> as the FinBook code for <strong>{picked!.party}</strong>?</span>
          <button type="button" onClick={rememberCode} style={rememberBtn}>REMEMBER</button>
        </div>
      )}
      {savedCode && (
        <div style={{ ...rememberBox, background: 'rgba(46,125,79,.08)', border: '1px solid rgba(46,125,79,.25)' }}>
          Saved — picking <strong>{picked!.party}</strong> will auto-fill <strong>{picked!.finbookClientId}</strong> next time.
        </div>
      )}

      {error && <div style={errBox}>Failed: {error}</div>}

      {resp && (
        <>
          {/* Credit limit card */}
          {resp.data.limit ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
              <Stat label="Credit limit" value={fmtINR(resp.data.limit.creditLimit)} />
              <Stat label="Outstanding" value={fmtINR(resp.data.limit.outstanding)} accent="#B5483D" />
              <Stat label="Available" value={fmtINR(resp.data.limit.available)}
                accent={resp.data.limit.available > 0 ? '#2E7D4F' : '#B5483D'} />
              <Stat label="Ledger balance" value={fmtINR(resp.data.ledger.closing)} />
            </div>
          ) : (
            <div style={{ ...errBox, color: 'var(--t-2)', background: 'rgba(15,40,85,0.04)', marginBottom: 18 }}>
              Credit limit unavailable{resp.data.limitError ? `: ${resp.data.limitError}` : ''}
            </div>
          )}

          {/* Ledger */}
          <div style={cardBox}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line, #e7eaf0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy-deep)' }}>
                {picked?.party || resp.data.ledger.clientName || resp.data.ledger.clientId}
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t-3)', marginLeft: 8 }}>{resp.data.ledger.clientId}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--t-2)' }}>
                {from} → {to} · Opening {fmtINR(resp.data.ledger.opening)} · Closing <strong style={{ color: 'var(--navy-deep)' }}>{fmtINR(resp.data.ledger.closing)}</strong>
              </div>
            </div>
            {resp.data.ledger.lines.length === 0 ? (
              <div style={{ padding: 28, color: 'var(--t-3)', fontSize: 13 }}>No ledger entries in this window.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Th>Date</Th><Th>Type</Th><Th>Doc</Th><Th>Particulars</Th>
                    <Th align="right">Debit</Th><Th align="right">Credit</Th><Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {resp.data.ledger.lines.map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                      <Td>{l.date}</Td>
                      <Td>{l.docType}</Td>
                      <Td><span style={{ fontSize: 12, color: 'var(--t-2)' }}>{l.docNo}</span></Td>
                      <Td>{l.narration}{l.refKey && <span style={{ fontSize: 10.5, color: 'var(--t-3)', marginLeft: 6 }}>ref {l.refKey}</span>}</Td>
                      <Td align="right">{l.debit ? fmtINR(l.debit) : '—'}</Td>
                      <Td align="right"><span style={{ color: l.credit ? 'var(--sage)' : undefined }}>{l.credit ? fmtINR(l.credit) : '—'}</span></Td>
                      <Td align="right"><strong style={{ color: 'var(--navy-deep)' }}>{fmtINR(l.balance)}</strong></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

// ─── bits ─────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent || 'var(--navy-deep)' }}>{value}</div>
    </div>
  );
}
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align || 'left', padding: '11px 16px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>;
}
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ textAlign: align || 'left', padding: '10px 16px', color: 'var(--t-1)', verticalAlign: 'middle' }}>{children}</td>;
}

const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, padding: '10px 12px', border: '1px solid var(--line, #e7eaf0)', borderRadius: 8, outline: 'none', color: 'var(--navy-deep)', fontFamily: 'inherit', background: '#fff' };
const fieldLbl: React.CSSProperties = { display: 'block', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 5 };
const dateLbl: React.CSSProperties = { display: 'inline-flex', flexDirection: 'column', gap: 5, fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t-3)' };
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', cursor: 'pointer', whiteSpace: 'nowrap' };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12.5, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const bannerSim: React.CSSProperties = { padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#8a5a00', background: 'rgba(201,138,20,.12)', border: '1px solid rgba(201,138,20,.3)' };
const bannerLive: React.CSSProperties = { padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#2E7D4F', background: 'rgba(46,125,79,.1)', border: '1px solid rgba(46,125,79,.3)' };
const dropdown: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 10, boxShadow: '0 10px 30px rgba(15,40,85,.14)', overflow: 'hidden', maxHeight: 320, overflowY: 'auto' };
const hitRow: React.CSSProperties = { display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--line, #f0f2f6)', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };
const rememberBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: 12.5, color: 'var(--navy-deep)', background: 'rgba(26,111,168,.06)', border: '1px solid rgba(26,111,168,.22)' };
const rememberBtn: React.CSSProperties = { marginLeft: 'auto', background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', cursor: 'pointer' };
