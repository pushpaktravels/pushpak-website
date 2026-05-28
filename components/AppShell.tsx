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
import { useEffect, useRef, useState } from 'react';
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

  // Idle auto-logout. Default 30 min — owner can tweak via the
  // SESSION_IDLE_MINUTES Setting. Any mousemove / keydown / click /
  // scroll / touchstart resets the timer.
  //
  // The same listeners feed the activity-tracker below: lastInputRef
  // records the most recent input timestamp so the heartbeat only
  // fires when both (tab visible) AND (input within last 90s).
  const lastInputRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!user) return;
    let timer: any;
    const IDLE_MS = 30 * 60 * 1000;
    function logoutNow() {
      sessionStorage.removeItem(USER_CACHE_KEY);
      fetch('/api/logout', { method: 'POST' }).finally(() => {
        router.replace('/login?reason=idle');
      });
    }
    function reset() {
      lastInputRef.current = Date.now();
      clearTimeout(timer); timer = setTimeout(logoutNow, IDLE_MS);
    }
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [user, router]);

  // Active-time heartbeat — fires every 30s ONLY when:
  //   1. the tab is currently visible (not in background)
  //   2. there was an input event within the last 90 seconds
  // The server side computes elapsed-since-last-ping and adds it to
  // the user's row in ActivityDay (capped at 90s per ping). This
  // means walking away from the laptop stops the clock automatically.
  useEffect(() => {
    if (!user) return;
    const PING_EVERY_MS = 30_000;
    const ACTIVE_WINDOW_MS = 90_000;
    let id: any;

    function tick() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInputRef.current > ACTIVE_WINDOW_MS) return;
      // Fire and forget — failure is fine, the next ping will retry
      fetch('/api/activity/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: router.pathname || '/' }),
        keepalive: true,
      }).catch(() => {});
    }
    // Fire one immediately so the "online" indicator updates fast
    tick();
    id = setInterval(tick, PING_EVERY_MS);
    return () => clearInterval(id);
  }, [user, router.pathname]);

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
        <MainWithScrollTop>{children}</MainWithScrollTop>
      </div>
    </>
  );
}

// Scrollable main with a floating "back to top" button that appears
// after the user has scrolled past a threshold. Mounted at the shell
// level so every page gets it for free.
function MainWithScrollTop({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setShow(el.scrollTop > 400);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <main ref={ref} className="content scroll" style={{ position: 'relative' }}>
      {children}
      {show && (
        <button
          onClick={() => ref.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 800,
            width: 44, height: 44, borderRadius: 999,
            background: 'linear-gradient(180deg,#1A3F7E,#0F2855)',
            color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(15,40,85,0.30)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </main>
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
