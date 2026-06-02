// ============================================================
// /portal/marketing — Marketing desk: lead funnel dashboard.
// ============================================================
// The marketing desk's home. Reads the shared Lead table via
// /api/marketing/overview and shows the funnel by stage, the channel mix
// by source, where leads are routed by department, and headline
// conversion / pipeline value — with a time-window switch and a jump
// straight into the Leads board to work the pipeline.
// ============================================================
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../components/AppShell';
import { fmtINR } from '../../lib/fmt';

type Overview = {
  window: number | string;
  totals: { total: number; active: number; won: number; lost: number; wonValue: number; pipelineValue: number; conversionPct: number | null };
  byStage: Record<string, number>;
  bySource: { source: string; n: number }[];
  byDepartment: { department: string; n: number }[];
};

const STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost'];
const STAGE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', quoted: 'Quoted', negotiating: 'Negotiating', won: 'Won', lost: 'Lost',
};
const STAGE_COLOR: Record<string, string> = {
  new: '#1A3F7E', contacted: '#1A6FA8', quoted: '#C98A14', negotiating: '#B5731D', won: '#2E7D4F', lost: '#B5483D',
};
const DEPT_LABEL: Record<string, string> = {
  'domestic-reservations': 'Domestic Reservations', 'domestic-package': 'Domestic Package',
  'international-packages': 'International Packages', visa: 'Visa', '(unrouted)': 'Unrouted',
};
const WINDOWS = [
  { key: '0', label: 'All time' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
];

export default function MarketingPage() {
  const [days, setDays] = useState('0');
  const [d, setD] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null); setD(null);
    const p = days !== '0' ? `?days=${days}` : '';
    fetch(`/api/marketing/overview${p}`)
      .then(r => r.json())
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Failed'); setD(r.data); })
      .catch(e => setError(e.message));
  }, [days]);

  const maxStage = d ? Math.max(1, ...STAGES.map(s => d.byStage[s] || 0)) : 1;
  const maxSource = d ? Math.max(1, ...d.bySource.map(s => s.n)) : 1;

  return (
    <AppShell title="Marketing" crumb="Marketing">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Marketing</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--t-2)', lineHeight: 1.55 }}>
            The lead funnel across every channel and department. Capture and work individual leads in the Leads board.
          </p>
        </div>
        <Link href="/portal/leads" style={addBtn}>OPEN LEADS BOARD →</Link>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {WINDOWS.map(w => (
          <button key={w.key} onClick={() => setDays(w.key)} style={chip(days === w.key)}>{w.label}</button>
        ))}
      </div>

      {error && <div style={errBox}>Failed: {error}</div>}
      {!d && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}

      {d && (
        <>
          {/* Headline stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Stat label="Total leads" value={String(d.totals.total)} />
            <Stat label="Active pipeline" value={String(d.totals.active)} />
            <Stat label="Won" value={String(d.totals.won)} accent="#2E7D4F" />
            <Stat label="Conversion" value={d.totals.conversionPct == null ? '—' : `${d.totals.conversionPct}%`}
              accent={d.totals.conversionPct != null && d.totals.conversionPct >= 30 ? '#2E7D4F' : '#C98A14'} />
            <Stat label="Won value" value={fmtINR(d.totals.wonValue)} accent="#2E7D4F" />
            <Stat label="Pipeline value" value={fmtINR(d.totals.pipelineValue)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {/* Funnel by stage */}
            <Panel title="Funnel by stage">
              {STAGES.map(s => {
                const n = d.byStage[s] || 0;
                return (
                  <div key={s} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: STAGE_COLOR[s] }}>{STAGE_LABEL[s]}</span>
                      <span style={{ color: 'var(--t-2)', fontWeight: 600 }}>{n}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 5, background: 'rgba(15,40,85,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${(n / maxStage) * 100}%`, height: '100%', background: STAGE_COLOR[s], borderRadius: 5 }} />
                    </div>
                  </div>
                );
              })}
            </Panel>

            {/* Channel mix by source */}
            <Panel title="Channel mix (source)">
              {d.bySource.length === 0 && <Empty />}
              {d.bySource.map(s => (
                <div key={s.source} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink)', textTransform: 'capitalize' }}>{s.source}</span>
                    <span style={{ color: 'var(--t-2)', fontWeight: 600 }}>{s.n}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 5, background: 'rgba(15,40,85,0.06)', overflow: 'hidden' }}>
                    <div style={{ width: `${(s.n / maxSource) * 100}%`, height: '100%', background: '#1A6FA8', borderRadius: 5 }} />
                  </div>
                </div>
              ))}
            </Panel>

            {/* Routing by department */}
            <Panel title="Routed to department">
              {d.byDepartment.length === 0 && <Empty />}
              {d.byDepartment.map(dep => (
                <div key={dep.department} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(15,40,85,0.06)' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{DEPT_LABEL[dep.department] || dep.department}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-deep)' }}>{dep.n}</span>
                </div>
              ))}
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--navy-deep)' }}>{value}</div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}
function Empty() { return <div style={{ fontSize: 12.5, color: 'var(--t-3)', padding: '8px 0' }}>No leads in this window.</div>; }

const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, border: active ? '1px solid var(--navy-deep, #1A3F7E)' : '1px solid rgba(15,40,85,0.2)', background: active ? 'var(--navy-deep, #1A3F7E)' : '#fff', color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const addBtn: React.CSSProperties = { background: 'var(--navy-deep)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none', boxShadow: '0 4px 14px rgba(15,40,85,.18)' };
const errBox: React.CSSProperties = { padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12, background: 'rgba(181,72,61,.08)', borderRadius: 8 };
