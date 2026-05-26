// ============================================================
// AppShell — wraps every authenticated page.
// ============================================================
// Renders sidebar + header + the page's content via children.
//
// User auth: fetches /api/me on mount. To avoid a full-screen
// loader flash on EVERY navigation, the user payload is cached in
// sessionStorage and hydrated synchronously on subsequent mounts,
// then re-validated against /api/me in the background. After the
// first login per browser session, the loader effectively never
// shows again.
//
// Loader: BrandedLoader uses a TRANSPARENT background so whatever
// is rendered behind it (typically nothing on first load, or the
// previous page during a soft navigation) shows through. Just the
// centered pushpak logo + a thin animated bar.
// ============================================================
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Sidebar, type CurrentUser } from './Sidebar';
import { Header } from './Header';

const USER_CACHE_KEY = 'pushpak:user';

function readCachedUser(): CurrentUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function AppShell({
  title, crumb, children,
}: { title: string; crumb?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(() => readCachedUser());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then(r => r.json())
      .then(r => {
        if (cancelled) return;
        if (!r?.ok) {
          sessionStorage.removeItem(USER_CACHE_KEY);
          router.replace('/login');
          return;
        }
        setUser(r.user);
        try { sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(r.user)); } catch {}
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load user'); });
    return () => { cancelled = true; };
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

// ─── Branded loader ──────────────────────────────────────────
// Transparent background, fixed overlay, centered. Whatever is
// rendered behind it shows through — no solid color takeover.
function BrandedLoader() {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 20, zIndex: 999,
      background: 'transparent',
      pointerEvents: 'none',
    }}>
      <img
        src="/pushpak-logo.png"
        alt="Pushpak"
        style={{ height: 56, width: 'auto', opacity: 0.9 }}
      />
      <div style={{
        width: 180, height: 2, borderRadius: 2,
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
    </div>
  );
}
