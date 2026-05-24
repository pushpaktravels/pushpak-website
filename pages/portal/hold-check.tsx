// ============================================================
// /portal/hold-check — booking team's quick-lookup tool.
// ============================================================
// Type 2+ characters of a client/family name → live list of
// matching accounts with hold status + outstanding + tier + exec.
// Click any row to open the AccountDrawer for full detail.
//
// Debounced 250ms so we don't hammer /api/hold-check on every key.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountDrawer } from '../../components/AccountDrawer';
import { TierBadge } from '../../components/TierBadge';
import { fmtINR } from '../../lib/fmt';

type Row = {
  id: string;
  party: string;
  family: string | null;
  exec: string | null;
  cm: string | null;
  bill: string | number;
  tier: string;
  onHold: string | null;
  alert: string | null;
  creditLimit: string | number;
  creditPeriod: string | null;
};

export default function HoldCheckPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Debounced search.
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); setError(null); return; }
    const t = setTimeout(() => {
      setLoading(true); setError(null);
      fetch(`/api/hold-check?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json())
        .then(r => {
          if (!r?.ok) throw new Error(r?.error || 'Search failed');
          setRows(r.data || []);
        })
        .catch(e => { setError(e.message); setRows([]); })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <AppShell title="Hold Check" crumb="Hold Check">
      {/* Search bar */}
      <div style={{
        background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
        borderRadius: 12, padding: 18, marginBottom: 20,
      }}>
        <label style={{ display: 'block', fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 8 }}>
          Search by client or family name
        </label>
        <input
          type="text"
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="e.g. AGARWAL or RAJESH TRADERS"
          style={{
            width: '100%', fontSize: 15, padding: '12px 14px',
            border: '1px solid var(--line, #e7eaf0)', borderRadius: 8,
            outline: 'none', color: 'var(--navy-deep)',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 8 }}>
          {q.trim().length < 2
            ? 'Type at least 2 characters to begin'
            : loading
              ? 'Searching…'
              : `${rows.length} match${rows.length === 1 ? '' : 'es'}`}
        </div>
      </div>

      {/* Results */}
      {error && (
        <div style={{ color: 'var(--rust)', padding: 16 }}>Failed: {error}</div>
      )}

      {!error && q.trim().length >= 2 && !loading && rows.length === 0 && (
        <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No matching accounts</h3>
          <p style={{ color: 'var(--t-2)' }}>
            No client or family contains "<strong>{q}</strong>". This usually means the booking is safe to proceed — verify with accounts team if unsure.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{
          background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Tier</Th>
                <Th>Party</Th>
                <Th>Family</Th>
                <Th align="right">Outstanding</Th>
                <Th>Hold</Th>
                <Th>Alert</Th>
                <Th>Exec</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid var(--line, #e7eaf0)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2, #f6f8fb)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Td><TierBadge tier={r.tier} /></Td>
                  <Td><strong style={{ color: 'var(--navy-deep)' }}>{r.party}</strong></Td>
                  <Td>{r.family || '—'}</Td>
                  <Td align="right" mono>{fmtINR(Number(r.bill))}</Td>
                  <Td><HoldPill status={r.onHold} /></Td>
                  <Td>{r.alert || '—'}</Td>
                  <Td>{r.exec || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer */}
      <AccountDrawer accountId={openId} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}

// ─── Tiny presentational bits ─────────────────────────────────
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align || 'left',
      padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
      textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700,
    }}>{children}</th>
  );
}

function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle',
      fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
    }}>{children}</td>
  );
}

function HoldPill({ status }: { status: string | null }) {
  if (!status) {
    return <span style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 600 }}>Clear</span>;
  }
  const map: Record<string, { bg: string; fg: string }> = {
    Active:    { bg: 'rgba(178,79,55,.16)',  fg: 'var(--rust)' },
    Candidate: { bg: 'rgba(217,165,69,.18)', fg: 'var(--amber)' },
  };
  const s = map[status] || { bg: 'rgba(120,130,150,.18)', fg: 'var(--t-2)' };
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700,
      letterSpacing: '.12em', textTransform: 'uppercase',
      padding: '4px 8px', borderRadius: 6,
    }}>{status}</span>
  );
}
