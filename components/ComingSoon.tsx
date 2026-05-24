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
};

export function ComingSoon({ title, crumb, blurb }: Props) {
  return (
    <AppShell title={title} crumb={crumb}>
      <div className="view-empty" style={{ marginTop: 40, textAlign: 'center', padding: '60px 40px' }}>
        <div style={{
          fontSize: 11,
          letterSpacing: '.22em',
          textTransform: 'uppercase',
          color: 'var(--t-3)',
          fontWeight: 700,
          marginBottom: 16,
        }}>
          In development
        </div>
        <h3 style={{ fontSize: 22, color: 'var(--navy-deep)', fontWeight: 600, marginBottom: 14 }}>
          {title} — coming soon
        </h3>
        <p style={{ color: 'var(--t-2)', maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>
          {blurb || `This view is part of an upcoming build phase. The database schema is in place and the route is reserved — implementation lands in the next session.`}
        </p>
      </div>
    </AppShell>
  );
}
