// ============================================================
// /portal/settings — system configuration editor.
// ============================================================
// Categories are shown as collapsible cards in a fixed order:
//   Escalation Thresholds · Auto Booking Hold · Worklist / Alerts
//   Daily Briefing Email · Points Engine · Branding · Tiers
//
// Each card shows: chevron · category title · short description ·
// "N SETTINGS" counter. Click to expand → inline editors for
// each setting in that category. Dirty rows accumulate in the
// page-level edits state; a sticky save bar at the top commits
// all pending changes in one PATCH.
// ============================================================
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { fmtDateTime } from '../../lib/fmt';

type Setting = { key: string; value: string; category: string; updatedAt: string; updatedBy: string | null };

// ─── Category metadata (display title + description + sort order) ─
const CATEGORY_META: Record<string, { title: string; description: string; order: number }> = {
  escalation:     { title: 'Escalation Thresholds',  description: 'Calls × max days before bumping to next stage, per Tier × Stage',  order: 1 },
  'auto-hold':    { title: 'Auto Booking Hold',      description: 'Rules that flag accounts as hold candidates during refresh',       order: 2 },
  worklist:       { title: 'Worklist / Alerts',      description: 'Thresholds for "Due Soon" and "Stale"',                              order: 3 },
  alerts:         { title: 'Worklist / Alerts',      description: 'Thresholds for "Due Soon" and "Stale"',                              order: 3 },
  email:          { title: 'Daily Briefing Email',   description: 'Sent to this address at the configured hour',                       order: 4 },
  points:         { title: 'Points Engine',          description: 'How many points each action awards or deducts',                     order: 5 },
  branding:       { title: 'Branding',               description: 'Names shown in the daily email and elsewhere',                       order: 6 },
  tiers:          { title: 'Tier Thresholds',        description: 'Outstanding cutoffs for tier classification',                       order: 7 },
  misc:           { title: 'Other',                  description: 'Uncategorised settings',                                            order: 99 },
};
function metaFor(cat: string) {
  return CATEGORY_META[cat] || { title: cat, description: '', order: 50 };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['email']));

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
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      }).then(x => x.json());
      if (!r?.ok) throw new Error(r?.error || 'Failed to save');
      setSavedMsg(`Saved ${r.updated} setting${r.updated === 1 ? '' : 's'}.`);
      setTimeout(() => setSavedMsg(null), 3000);
      load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  function toggle(cat: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  if (error && !settings) return <AppShell title="Settings" crumb="System Configuration"><div style={{ padding: 16, color: 'var(--rust)' }}>Failed: {error}</div></AppShell>;
  if (!settings) return <AppShell title="Settings" crumb="System Configuration"><div style={{ padding: 32, color: 'var(--t-3)' }}>Loading…</div></AppShell>;

  // Group settings by category
  const byCategory: Record<string, Setting[]> = {};
  settings.forEach(s => (byCategory[s.category] ||= []).push(s));
  const categories = Object.keys(byCategory).sort(
    (a, b) => metaFor(a).order - metaFor(b).order
  );

  return (
    <AppShell title="Settings" crumb="System Configuration">
      {/* Page header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy-deep)', margin: 0, letterSpacing: '-.014em' }}>Settings</h2>
      </div>

      {/* Save bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 18px', marginBottom: 16, borderRadius: 12,
        background: dirty ? 'var(--navy-deep)' : 'var(--bg-1, #fff)',
        color: dirty ? '#fff' : 'inherit',
        border: dirty ? '1px solid var(--navy-deep)' : '1px solid var(--line, #e7eaf0)',
        transition: 'background .15s ease',
      }}>
        <div style={{ fontSize: 12 }}>
          {dirty
            ? <strong>{Object.keys(edits).length} unsaved change{Object.keys(edits).length === 1 ? '' : 's'}</strong>
            : savedMsg ? <span style={{ color: 'var(--sage)', fontWeight: 600 }}>{savedMsg}</span>
            : 'All settings up to date.'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {dirty && (
            <button onClick={() => setEdits({})} disabled={saving} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,.3)',
              color: '#fff', borderRadius: 8, padding: '8px 14px',
              fontSize: 11, fontWeight: 700, letterSpacing: '.12em',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}>DISCARD</button>
          )}
          <button onClick={saveAll} disabled={!dirty || saving} style={{
            background: dirty ? '#fff' : 'var(--navy-deep)',
            color: dirty ? 'var(--navy-deep)' : '#fff',
            border: 'none', borderRadius: 8, padding: '8px 18px',
            fontSize: 11, fontWeight: 700, letterSpacing: '.12em',
            cursor: (dirty && !saving) ? 'pointer' : 'not-allowed',
            opacity: (dirty && !saving) ? 1 : 0.5,
          }}>{saving ? 'SAVING…' : 'SAVE CHANGES'}</button>
        </div>
      </div>

      {error && <div style={{ padding: 12, marginBottom: 12, color: 'var(--rust)', fontSize: 12 }}>Failed: {error}</div>}

      {/* Collapsible category cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {categories.map(cat => {
          const meta = metaFor(cat);
          const isOpen = expanded.has(cat);
          const list = byCategory[cat];
          const dirtyCount = list.filter(s => edits[s.key] !== undefined).length;

          return (
            <div key={cat} style={{
              background: '#fff',
              border: `1px solid ${isOpen ? 'var(--navy)' : 'var(--line, #e7eaf0)'}`,
              borderRadius: 14, overflow: 'hidden',
              boxShadow: isOpen ? '0 4px 14px rgba(15,40,85,.08)' : 'none',
              transition: 'border-color .15s, box-shadow .15s',
            }}>
              {/* Category header row */}
              <button onClick={() => toggle(cat)} style={{
                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                cursor: 'pointer', padding: '18px 22px',
                display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 16, alignItems: 'center',
              }}>
                <span style={{
                  color: 'var(--t-2)', fontSize: 18,
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform .15s ease',
                  display: 'inline-block', lineHeight: 1,
                }}>›</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-deep)', letterSpacing: '-.01em' }}>{meta.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t-3)', marginTop: 4 }}>
                    {meta.description}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase',
                  color: dirtyCount > 0 ? 'var(--amber)' : 'var(--t-3)', fontWeight: 700,
                }}>
                  {dirtyCount > 0 && `${dirtyCount} unsaved · `}{list.length} settings
                </span>
              </button>

              {/* Expanded body */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--line, #e7eaf0)' }}>
                  {list.map((s, i) => {
                    const editing = edits[s.key] !== undefined;
                    const current = editing ? edits[s.key] : s.value;
                    return (
                      <div key={s.key} style={{
                        padding: '14px 22px',
                        borderBottom: i === list.length - 1 ? 'none' : '1px solid var(--line, #e7eaf0)',
                        display: 'grid', gridTemplateColumns: '1fr 240px', gap: 18, alignItems: 'center',
                      }}>
                        <div>
                          <div style={{
                            fontFamily: "inherit",
                            fontSize: 12.5, color: 'var(--navy-deep)', fontWeight: 600,
                            letterSpacing: '.02em',
                          }}>{s.key}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--t-3)', marginTop: 4, letterSpacing: '.02em' }}>
                            Updated {fmtDateTime(s.updatedAt)}{s.updatedBy && ` · by ${s.updatedBy}`}
                          </div>
                        </div>
                        <input
                          type="text"
                          value={current}
                          onChange={e => setEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                          style={{
                            fontSize: 14, padding: '9px 12px',
                            border: `1px solid ${editing ? 'var(--amber)' : 'var(--line, #e7eaf0)'}`,
                            borderRadius: 6, outline: 'none', color: 'var(--navy-deep)',
                            fontFamily: "inherit",
                            background: editing ? 'rgba(176,127,28,.07)' : '#fff',
                            transition: 'border-color .12s',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
