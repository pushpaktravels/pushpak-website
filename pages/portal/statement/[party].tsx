// ============================================================
// /portal/statement/[party] — printable Statement of Accounts.
// ============================================================
// Renders a clean, branded statement page that prints (Cmd+P → PDF)
// well on A4. Uses an isolated layout (no AppShell sidebar) so the
// PDF is just the document. The Print button triggers window.print().
//
// Linked from the AccountDrawer's "Statement" action.
// ============================================================
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

type Stmt = {
  party: string; family: string | null;
  exec: string | null; cm: string | null;
  bill: number; d30: number; d60: number; d90: number; d90p: number;
  recentCall: string | null; nextFu: string | null;
  creditLimit: number; creditPeriod: string | null;
  client: any | null;
  history: Array<{ ts: string; action: string; newValue: string | null; outstanding: number | null }>;
  promises: Array<{ expectedBy: string; outstandingAt: number; status: string; amountReceived: number }>;
};

const INR = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';

export default function StatementPage() {
  const router = useRouter();
  const party = router.query.party as string | undefined;
  const [data, setData] = useState<Stmt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!party) return;
    fetch(`/api/statement?party=${encodeURIComponent(party)}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed');
        setData(r.data);
      })
      .catch(e => setError(e.message));
  }, [party]);

  if (error) return <div style={{ padding: 40, color: '#B5483D', fontFamily: 'Inter, sans-serif' }}>Failed: {error}</div>;
  if (!data) return <div style={{ padding: 40, color: '#475569', fontFamily: 'Inter, sans-serif' }}>Loading…</div>;

  return (
    <>
      <Head><title>Statement · {data.party} · Pushpak Travels</title></Head>
      <style jsx global>{`
        @page { size: A4; margin: 16mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
        body { font-family: 'Inter', system-ui, sans-serif; color: #0F2855; background: #F4F4F0; }
      `}</style>

      {/* Toolbar (hidden on print) */}
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0F2855', color: '#fff',
        padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Statement preview</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Press <kbd>Cmd+P</kbd> / <kbd>Ctrl+P</kbd> → Save as PDF</div>
        <button onClick={() => window.print()} style={{
          marginLeft: 'auto', background: '#C9A472', border: 'none', color: '#0F2855',
          padding: '8px 16px', borderRadius: 6, fontWeight: 700,
          letterSpacing: '.18em', textTransform: 'uppercase', fontSize: 11, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>Print · Save PDF</button>
        <button onClick={() => window.close()} style={{
          background: 'transparent', border: '1px solid rgba(255,255,255,0.3)',
          color: '#fff', padding: '8px 14px', borderRadius: 6, fontWeight: 700,
          letterSpacing: '.18em', textTransform: 'uppercase', fontSize: 11, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>Close</button>
      </div>

      {/* The document */}
      <div style={{
        maxWidth: 800, margin: '20px auto 40px', background: '#fff',
        padding: '40px 48px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 16, borderBottom: '2px solid #0F2855' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0F2855' }}>PUSHPAK AIR TRAVELS</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>Guwahati, Assam 781007</div>
            <div style={{ fontSize: 12, color: '#475569' }}>www.flypushpak.com</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase', color: '#475569', fontWeight: 700 }}>Statement of Accounts</div>
            <div style={{ fontSize: 13, color: '#0F2855', marginTop: 4 }}>
              as of {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}
            </div>
          </div>
        </div>

        {/* Party block */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: '#475569', fontWeight: 700, marginBottom: 8 }}>Bill to</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F2855' }}>{data.party}</div>
          {data.family && <div style={{ fontSize: 12, color: '#475569' }}>Family: {data.family}</div>}
          {data.client?.address && <div style={{ fontSize: 12, color: '#475569', marginTop: 4, whiteSpace: 'pre-wrap' }}>{data.client.address}</div>}
        </div>

        {/* Outstanding box */}
        <div style={{
          padding: '22px 26px', borderRadius: 10,
          background: 'linear-gradient(160deg,#1A3F7E,#0F2855)', color: '#fff',
          marginBottom: 32,
        }}>
          <div style={{ fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase', opacity: 0.7, fontWeight: 700 }}>Total Outstanding</div>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{INR(data.bill)}</div>
          {data.creditLimit > 0 && (
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Credit limit: {INR(data.creditLimit)}{data.creditPeriod ? ` · Terms: ${data.creditPeriod}` : ''}
            </div>
          )}
        </div>

        {/* Aging breakdown */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: '#475569', fontWeight: 700, marginBottom: 10 }}>Aging Breakdown</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { label: '0 – 30 days',  v: data.d30 },
              { label: '31 – 60 days', v: data.d60 },
              { label: '61 – 90 days', v: data.d90 },
              { label: '> 90 days',    v: data.d90p, accent: true },
            ].map(b => (
              <div key={b.label} style={{
                padding: '12px 14px', borderRadius: 8,
                background: b.accent ? 'rgba(178,79,55,0.10)' : 'rgba(15,40,85,0.04)',
                border: b.accent ? '1px solid rgba(178,79,55,0.30)' : 'none',
              }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, marginBottom: 4 }}>{b.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: b.accent ? '#B5483D' : '#0F2855', fontVariantNumeric: 'tabular-nums' }}>{INR(b.v)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        {data.history.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: '#475569', fontWeight: 700, marginBottom: 10 }}>Recent Activity</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(15,40,85,0.04)' }}>
                  <th style={thS}>Date</th>
                  <th style={thS}>Action</th>
                  <th style={thS}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.history.slice(0, 15).map((h, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(15,40,85,0.05)' }}>
                    <td style={tdS}>{fmtDate(h.ts)}</td>
                    <td style={tdS}>{h.action}</td>
                    <td style={tdS}>{h.newValue || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Promises */}
        {data.promises.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: '#475569', fontWeight: 700, marginBottom: 10 }}>Payment Promises</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(15,40,85,0.04)' }}>
                  <th style={thS}>Expected by</th>
                  <th style={thS}>Amount</th>
                  <th style={thS}>Received</th>
                  <th style={thS}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.promises.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(15,40,85,0.05)' }}>
                    <td style={tdS}>{fmtDate(p.expectedBy)}</td>
                    <td style={{...tdS, fontVariantNumeric: 'tabular-nums'}}>{INR(p.outstandingAt)}</td>
                    <td style={{...tdS, fontVariantNumeric: 'tabular-nums'}}>{p.amountReceived > 0 ? INR(p.amountReceived) : '—'}</td>
                    <td style={tdS}>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Payment instructions */}
        <div style={{
          padding: '16px 20px', borderRadius: 8,
          background: 'rgba(46,108,84,0.08)', border: '1px solid rgba(46,108,84,0.24)',
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: '#2E6C54', fontWeight: 700, marginBottom: 8 }}>Payment Instructions</div>
          <div style={{ fontSize: 12, color: '#0F2855', lineHeight: 1.6 }}>
            Please remit the outstanding balance via NEFT / RTGS / UPI at the earliest. For payment queries
            or to schedule a payment plan, contact: <b>accounts@flypushpak.com</b>
            {data.exec && <> or your account executive <b>{data.exec}</b>.</>}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 36, paddingTop: 16, borderTop: '1px solid rgba(15,40,85,0.10)',
          fontSize: 10, color: '#475569', textAlign: 'center',
        }}>
          This statement is computer-generated by the Pushpak Debtor Control Portal. Generated on {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.
        </div>
      </div>
    </>
  );
}

const thS: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 9.5, letterSpacing: '.16em', textTransform: 'uppercase', color: '#475569', fontWeight: 700 };
const tdS: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: '#0F2855', borderBottom: '1px solid rgba(15,40,85,0.04)' };
