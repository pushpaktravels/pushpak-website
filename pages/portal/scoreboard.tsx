// ============================================================
// /portal/scoreboard — exec leaderboard.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';

type Ranking = {
  exec: string;
  points: number;
  event_count: number;
  calls: number;
  kept: number;
  broken: number;
  recoveries: number;
};

const WINDOWS = [
  { key: 7,  label: 'This week' },
  { key: 30, label: 'This month' },
  { key: 90, label: '90 days' },
];

const MEDAL = ['🥇', '🥈', '🥉'];

export default function ScoreboardPage() {
  const [days, setDays] = useState(30);
  const [rankings, setRankings] = useState<Ranking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRankings(null); setError(null);
    fetch(`/api/scoreboard?days=${days}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setRankings(r.data.rankings || []);
      })
      .catch(e => setError(e.message));
  }, [days]);

  return (
    <AppShell title="Scoreboard" crumb="Scoreboard">
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12,
      }}>
        {WINDOWS.map(w => (
          <Chip key={w.key} active={days === w.key} onClick={() => setDays(w.key)}>{w.label}</Chip>
        ))}
      </div>

      {error && <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div>}
      {rankings === null && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {rankings && rankings.length === 0 && (
        <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No scores in this window</h3>
          <p style={{ color: 'var(--t-2)' }}>Only execs with Scoreboard enabled show up here. Toggle on Users & Authorities.</p>
        </div>
      )}

      {rankings && rankings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rankings.map((r, idx) => (
            <div key={r.exec} style={{
              background: idx === 0 ? 'linear-gradient(135deg, #0b1629 0%, #1a2540 100%)' : 'var(--bg-1, #fff)',
              color: idx === 0 ? '#fff' : 'inherit',
              border: '1px solid var(--line, #e7eaf0)',
              borderRadius: 12, padding: '18px 22px',
              display: 'flex', alignItems: 'center', gap: 18,
            }}>
              <div style={{ fontSize: 28, minWidth: 44, textAlign: 'center' }}>
                {idx < 3 ? MEDAL[idx] : <span style={{ color: idx === 0 ? '#fff' : 'var(--t-3)', fontSize: 14, fontWeight: 700 }}>#{idx + 1}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: idx === 0 ? '#fff' : 'var(--navy-deep)', marginBottom: 4 }}>
                  {r.exec}
                </div>
                <div style={{ display: 'flex', gap: 14, fontSize: 11, color: idx === 0 ? 'rgba(255,255,255,.7)' : 'var(--t-3)' }}>
                  <span>{r.calls} calls</span>
                  <span style={{ color: idx === 0 ? 'rgba(132,194,156,.95)' : 'var(--sage)' }}>{r.kept} kept</span>
                  {r.broken > 0 && <span style={{ color: idx === 0 ? 'rgba(232,142,121,.95)' : 'var(--rust)' }}>{r.broken} broken</span>}
                  {r.recoveries > 0 && <span style={{ color: idx === 0 ? 'rgba(132,194,156,.95)' : 'var(--sage)' }}>{r.recoveries} recoveries</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 600,
                  color: idx === 0 ? '#fff' : 'var(--navy-deep)',
                }}>{r.points}</div>
                <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: idx === 0 ? 'rgba(255,255,255,.6)' : 'var(--t-3)', fontWeight: 600, marginTop: 2 }}>
                  Points
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} style={{ background: active ? 'var(--navy-deep)' : 'transparent', color: active ? '#fff' : 'var(--t-2)', border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{children}</button>; }
