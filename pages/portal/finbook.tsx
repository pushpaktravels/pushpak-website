// ============================================================
// /portal/finbook — FinBook console: live client ledger + credit limit.
// ============================================================
// The first FinBook vertical: look up any client by their FinBook id and
// see their live statement and sanctioned/available credit — inside the
// portal, no separate FinBook login. Read-only.
//
// Until Calico unblocks our server IP the integration runs in DRY-RUN: the
// numbers here are clearly badged "Simulated" so no one acts on them. The
// moment FINBOOK_MODE flips to 'live' the same screen shows real data.
// ============================================================
import { useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtINR } from '../../lib/fmt';

type Line = { date: string; docType: string; docNo: string; narration: string; debit: number; credit: number; balance: number; refKey?: string };
type Ledger = { clientId: string; clientName?: string; opening: number; closing: number; lines: Line[] };
type Limit = { clientId: string; creditLimit: number; outstanding: number; available: number; currency: string } | null;
type Resp = { mode: string; simulated: boolean; data: { ledger: Ledger; limit: Limit; limitError: string | null } };

export default function FinbookPage() {
  const [clientId, setClientId] = useState('');
  const [resp, setResp] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    const id = clientId.trim();
    if (!id) return;
    setLoading(true); setError(null); setResp(null);
    try {
      const r = await fetch(`/api/finbook/account?clientId=${encodeURIComponent(id)}`).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Lookup failed');
      setResp(r as Resp);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const dryrun = resp?.mode === 'dryrun' || resp?.simulated;

  return (
    <AppShell title="FinBook" crumb="FinBook">
      <div style={{ maxWidth: 760, marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>FinBook</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
          Look up any client&rsquo;s live FinBook ledger and credit limit without leaving the portal.
          Enter the FinBook client id (it starts with <strong>C</strong>, e.g. <code>CCA000001</code>).
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
      <form onSubmit={lookup} style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="FinBook client id (e.g. CCA000001)"
          style={{ ...inputStyle, maxWidth: 320 }}
        />
        <button type="submit" disabled={loading || !clientId.trim()} style={addBtn}>
          {loading ? 'LOADING…' : 'LOOK UP'}
        </button>
      </form>

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
                {resp.data.ledger.clientName || resp.data.ledger.clientId}
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t-3)', marginLeft: 8 }}>{resp.data.ledger.clientId}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--t-2)' }}>
                Opening {fmtINR(resp.data.ledger.opening)} · Closing <strong style={{ color: 'var(--navy-deep)' }}>{fmtINR(resp.data.ledger.closing)}</strong>
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
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', cursor: 'pointer', whiteSpace: 'nowrap' };
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, overflow: 'hidden' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12.5, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
const bannerSim: React.CSSProperties = { padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#8a5a00', background: 'rgba(201,138,20,.12)', border: '1px solid rgba(201,138,20,.3)' };
const bannerLive: React.CSSProperties = { padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#2E7D4F', background: 'rgba(46,125,79,.1)', border: '1px solid rgba(46,125,79,.3)' };
