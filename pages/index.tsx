// ============================================================
// Landing page — checks if user is signed in, routes accordingly.
// Shows a loading state while deciding, and a fallback link if
// the redirect ever stalls.
// ============================================================
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Home() {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    let done = false;
    const stallTimer = setTimeout(() => { if (!done) setStalled(true); }, 3000);

    fetch('/api/me')
      .then(r => r.json())
      .then(r => {
        done = true;
        clearTimeout(stallTimer);
        router.replace(r?.ok ? '/portal' : '/login');
      })
      .catch(() => {
        done = true;
        clearTimeout(stallTimer);
        router.replace('/login');
      });

    return () => clearTimeout(stallTimer);
  }, [router]);

  return (
    <>
      <Head><title>Pushpak Portal</title></Head>
      <main style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 18,
        background: 'linear-gradient(180deg, #1A3F7E, #0F2855)', color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '.04em' }}>Pushpak Portal</div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>{stalled ? 'Taking longer than usual…' : 'Loading…'}</div>
        {stalled && (
          <a href="/login" style={{
            marginTop: 8, padding: '10px 18px', background: '#fff', color: '#0F2855',
            borderRadius: 8, fontWeight: 600, textDecoration: 'none', fontSize: 13,
          }}>Go to Sign In</a>
        )}
      </main>
    </>
  );
}
