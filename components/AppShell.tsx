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
  if (!user) return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, #1A3F7E, #0F2855)', color: '#fff',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>
    </main>
  );

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
