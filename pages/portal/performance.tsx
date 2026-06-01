// ============================================================
// /portal/performance — exec activity dashboard.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtINR } from '../../lib/fmt';

type ExecStat = {
  exec: string;
  calls: number;
  accountsTouched: number;
  promisesAdded: number;
  promisesKept: number;
  promisesKeptOnTime: number;
  promisesBroken: number;
  onTimePct: number | null;
  recovered: number;
  recoveryCount: number;
};

const WINDOWS = [
  { key: 7,  label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
];

export default function PerformancePage() {
  const [days, setDays] = useState(30);
  const [execs, setExecs] = useState<ExecStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExecs(null); setError(null);
    fetch(`/api/performance?days=${days}`)
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setExecs(r.data.execs || []);
      })
      .catch(e => setError(e.message));
  }, [days]);

  return (
    <AppShell title="Performance" crumb="Performance">
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)', borderRadius: 12,
      }}>
        {WINDOWS.map(w => (
          <Chip key={w.key} active={days === w.key} onClick={() => setDays(w.key)}>{w.label}</Chip>
        ))}
      </div>

      {error && <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div>}
      {execs === null && !error && <div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div>}
      {execs && execs.length === 0 && (
        <div className="view-empty" style={{ padding: 40, textAlign: 'center' }}>
          <h3 style={{ fontSize: 18, color: 'var(--navy-deep)', marginBottom: 8 }}>No activity in this window</h3>
          <p style={{ color: 'var(--t-2)' }}>Activity will appear here once execs log calls, add promises, or close payments.</p>
        </div>
      )}

      {execs && execs.length > 0 && (
        <div style={{
          background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2, #f6f8fb)', borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                <Th>Exec</Th>
                <Th align="right">Calls</Th>
                <Th align="right">Accounts touched</Th>
                <Th align="right">Promises added</Th>
                <Th align="right">Kept</Th>
                <Th align="right">On time</Th>
                <Th align="right">Broken</Th>
                <Th align="right">Recovered</Th>
              </tr>
            </thead>
            <tbody>
              {execs.map(e => {
                const keptRate = (e.promisesKept + e.promisesBroken) > 0
                  ? Math.round(e.promisesKept * 100 / (e.promisesKept + e.promisesBroken))
                  : null;
                return (
                  <tr key={e.exec} style={{ borderBottom: '1px solid var(--line, #e7eaf0)' }}>
                    <Td><strong style={{ color: 'var(--navy-deep)' }}>{e.exec}</strong></Td>
                    <Td align="right" mono>{e.calls}</Td>
                    <Td align="right" mono>{e.accountsTouched}</Td>
                    <Td align="right" mono>{e.promisesAdded}</Td>
                    <Td align="right" mono>
                      <span style={{ color: 'var(--sage)' }}>{e.promisesKept}</span>
                      {keptRate != null && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--t-3)' }}>({keptRate}%)</span>}
                    </Td>
                    <Td align="right" mono>
                      {e.onTimePct == null
                        ? <span style={{ color: 'var(--t-3)' }}>—</span>
                        : <span style={{ fontWeight: 700, color: e.onTimePct >= 80 ? 'var(--sage)' : e.onTimePct >= 50 ? '#C98A14' : 'var(--rust)' }}>
                            {e.onTimePct}%
                            <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--t-3)' }}>{e.promisesKeptOnTime}/{e.promisesKept + e.promisesBroken}</div>
                          </span>}
                    </Td>
                    <Td align="right" mono><span style={{ color: 'var(--rust)' }}>{e.promisesBroken}</span></Td>
                    <Td align="right" mono><strong style={{ color: 'var(--sage)' }}>{fmtINR(e.recovered)}</strong>
                      {e.recoveryCount > 0 && <div style={{ fontSize: 10, color: 'var(--t-3)' }}>{e.recoveryCount} event{e.recoveryCount === 1 ? '' : 's'}</div>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} style={{ background: active ? 'var(--navy-deep)' : 'transparent', color: active ? '#fff' : 'var(--t-2)', border: active ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{children}</button>; }
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) { return <th style={{ textAlign: align || 'left', padding: '10px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{children}</th>; }
function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) { return <td style={{ textAlign: align || 'left', padding: '12px 14px', color: 'var(--t-1)', verticalAlign: 'middle', fontFamily: mono ? "inherit" : undefined }}>{children}</td>; }
