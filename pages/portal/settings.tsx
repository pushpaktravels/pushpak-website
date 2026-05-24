// ============================================================
// /portal/settings — system settings editor.
// ============================================================
// Settings grouped by category. Click a value → inline edit →
// Save (per row) or Save All (header) commits the change.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtDateTime } from '../../lib/fmt';

type Setting = { key: string; value: string; category: string; updatedAt: string; updatedBy: string | null };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function load() {
    fetch('/api/settings')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Failed to load');
        setSettings(r.data.settings || []);
        setEdits({});
      })
      .catch(e => setError(e.message));
  }
  useEffect(load, []);

  const dirty = Object.keys(edits).length > 0;

  async function saveAll() {
    setSaving(true); setError(null); setSavedMsg(null);
    try {
      const updates = Object.entries(edits).map(([key, value]) => ({ key, value }));
      const r = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      setSavedMsg(`Saved ${r.updated} setting${r.updated === 1 ? '' : 's'}.`);
      setTimeout(() => setSavedMsg(null), 3000);
      load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (error && !settings) return <AppShell title="Settings" crumb="Settings"><div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div></AppShell>;
  if (!settings) return <AppShell title="Settings" crumb="Settings"><div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div></AppShell>;

  // Group by category
  const byCategory: Record<string, Setting[]> = {};
  settings.forEach(s => (byCategory[s.category] ||= []).push(s));
  const categories = Object.keys(byCategory).sort();

  return (
    <AppShell title="Settings" crumb="Settings">
      {/* Save bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 18px', marginBottom: 16, borderRadius: 12,
        background: dirty ? 'var(--navy-deep)' : 'var(--bg-1, #fff)',
        color: dirty ? '#fff' : 'inherit',
        border: dirty ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)',
        transition: 'all .12s ease',
      }}>
        <div style={{ fontSize: 12 }}>
          {dirty
            ? <strong>{Object.keys(edits).length} unsaved change{Object.keys(edits).length === 1 ? '' : 's'}</strong>
            : savedMsg
              ? <span style={{ color: 'var(--sage)', fontWeight: 600 }}>{savedMsg}</span>
              : 'All settings up to date.'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {dirty && (
            <button onClick={() => setEdits({})} disabled={saving} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,.3)',
              color: '#fff', borderRadius: 8, padding: '8px 14px',
              fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            }}>Discard</button>
          )}
          <button onClick={saveAll} disabled={!dirty || saving} style={{
            background: dirty ? '#fff' : 'var(--navy-deep)',
            color: dirty ? 'var(--navy-deep)' : '#fff',
            border: 'none', borderRadius: 8, padding: '8px 18px',
            fontSize: 12, fontWeight: 700, cursor: (dirty && !saving) ? 'pointer' : 'not-allowed',
            opacity: (dirty && !saving) ? 1 : 0.5,
          }}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      {error && <div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div>}

      {/* Settings grouped by category */}
      {categories.map(cat => (
        <div key={cat} style={{
          background: 'var(--bg-1, #fff)', border: '1px solid var(--line, #e7eaf0)',
          borderRadius: 12, overflow: 'hidden', marginBottom: 14,
        }}>
          <div style={{
            padding: '12px 18px', borderBottom: '1px solid var(--line, #e7eaf0)',
            fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase',
            color: 'var(--t-3)', fontWeight: 700, background: 'var(--bg-2, #f6f8fb)',
          }}>{cat}</div>
          {byCategory[cat].map(s => {
            const editing = edits[s.key] !== undefined;
            const current = editing ? edits[s.key] : s.value;
            return (
              <div key={s.key} style={{
                padding: '14px 18px', borderBottom: '1px solid var(--line, #e7eaf0)',
                display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--navy-deep)', fontWeight: 600 }}>{s.key}</div>
                  <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3 }}>
                    Updated {fmtDateTime(s.updatedAt)} {s.updatedBy && `by ${s.updatedBy}`}
                  </div>
                </div>
                <input
                  type="text"
                  value={current}
                  onChange={e => setEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                  style={{
                    fontSize: 14, padding: '8px 12px',
                    border: `1px solid ${editing ? 'var(--amber)' : 'var(--line, #e7eaf0)'}`,
                    borderRadius: 6, outline: 'none', color: 'var(--navy-deep)',
                    fontFamily: "'JetBrains Mono', monospace",
                    background: editing ? 'rgba(217,165,69,.08)' : 'var(--bg-1, #fff)',
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </AppShell>
  );
}
