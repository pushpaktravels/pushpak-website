// ============================================================
// AppShell — wraps every authenticated page.
// Fetches the current user on mount → redirects to /login if not signed in.
// Renders sidebar + header + the page's content via children.
// Usage in any /portal/* page:
//   <AppShell title="My Worklist" crumb="Personal queue">
//     ...page content...
//   </AppShell>
// ============================================================
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Sidebar, type CurrentUser } from './Sidebar';
import { Header } from './Header';

export function AppShell({
  title, crumb, children,
}: { title: string; crumb?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(r => {
        if (!r?.ok) { router.replace('/login'); return; }
        setUser(r.user);
      })
      .catch(err => setError(err.message || 'Failed to load user'));
  }, [router]);

  if (error) return (
    <main style={{ padding: 40, color: 'var(--rust)' }}>Failed to load: {error}</main>
  );
  if (!user) return <BrandedLoader />;

  return (
    <>
      <Head><title>{title} · Pushpak Portal</title></Head>
      <div className="shell">
        <Sidebar user={user} />
        <Header user={user} title={title} crumb={crumb} />
        <main className="content scroll">{children}</main>
      </div>
    </>
  );
}

// ─── Branded loader (shown while /api/me is in-flight) ───────
// Light paper background + navy logo + thin indeterminate bar.
// Replaces the previous full-screen navy gradient + "Loading…" text
// which was disorienting because it briefly took over the whole window
// on every navigation.
function BrandedLoader() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 22,
      background: 'var(--paper, #F4F6FA)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <img
        src="/pushpak-logo.png"
        alt="Pushpak"
        style={{ height: 64, width: 'auto', opacity: 0.92 }}
      />
      <div style={{
        width: 200, height: 3, borderRadius: 2,
        background: 'rgba(15,40,85,0.10)', overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: '40%',
          background: 'var(--navy-deep)', borderRadius: 2,
          animation: 'loaderSlide 1.2s ease-in-out infinite',
        }} />
      </div>
      <style jsx>{`
        @keyframes loaderSlide {
          0%   { left: -40%; }
          60%  { left: 100%; }
          100% { left: 100%; }
        }
      `}</style>
    </main>
  );
}
