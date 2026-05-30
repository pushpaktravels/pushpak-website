// ============================================================
// ComingSoon — placeholder for pages that aren't built yet.
// Lives inside AppShell so the sidebar/header still render
// while the user explores. Drop-in shell for any /portal/* route
// not yet implemented.
// ============================================================
import { AppShell } from './AppShell';

type Props = {
  title: string;
  crumb: string;
  blurb?: string;
  // Optional bullet list of what this workspace will eventually hold.
  planned?: string[];
};

export function ComingSoon({ title, crumb, blurb, planned }: Props) {
  return (
    <AppShell title={title} crumb={crumb}>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}>
        <div style={card}>
          <div style={badge}>In development</div>
          <div style={iconRing}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" />
              <path d="M5 21V7l8-4v18" />
              <path d="M19 21V11l-6-4" />
              <path d="M9 9h.01M9 12h.01M9 15h.01M9 18h.01" />
            </svg>
          </div>
          <h3 style={{ fontSize: 22, color: 'var(--navy-deep)', fontWeight: 600, margin: '0 0 10px', letterSpacing: '-.014em' }}>
            {title} — coming soon
          </h3>
          <p style={{ color: 'var(--t-2)', maxWidth: 460, margin: 0, lineHeight: 1.6, fontSize: 13.5 }}>
            {blurb || `This department’s workspace is being built. The space is reserved and access is already wired — the tools will appear here soon.`}
          </p>

          {planned && planned.length > 0 && (
            <div style={plannedBox}>
              <div style={plannedLabel}>Planned for this workspace</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {planned.map(p => (
                  <li key={p} style={plannedItem}>
                    <span style={tick}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ─── styles ───────────────────────────────────────────────────
const card: React.CSSProperties = {
  position: 'relative', width: 'min(560px, 100%)',
  background: '#fff', border: '1px solid var(--line, #e7eaf0)', borderRadius: 16,
  padding: '40px 36px', textAlign: 'center',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  boxShadow: '0 10px 40px rgba(15,40,85,.06)',
};
const badge: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16,
  fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
  color: '#B58430', background: 'rgba(217,165,69,.16)', padding: '5px 10px', borderRadius: 999,
};
const iconRing: React.CSSProperties = {
  width: 64, height: 64, borderRadius: 999, marginBottom: 18,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-2, #f6f8fb)', border: '1px solid var(--line, #e7eaf0)',
  color: 'var(--navy, #1A3F7E)',
};
const plannedBox: React.CSSProperties = {
  marginTop: 28, width: '100%', textAlign: 'left',
  background: 'var(--bg-2, #f6f8fb)', border: '1px solid var(--line, #e7eaf0)',
  borderRadius: 12, padding: '18px 20px',
};
const plannedLabel: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
  color: 'var(--t-3)', fontWeight: 700, marginBottom: 12,
};
const plannedItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  fontSize: 13, color: 'var(--t-1)',
};
const tick: React.CSSProperties = {
  flexShrink: 0, width: 18, height: 18, borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(46,108,84,.14)', color: 'var(--sage, #2E6C54)',
};
