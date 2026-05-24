// ============================================================
// 2FA enrollment — shown on first login for owner/admin accounts.
// ============================================================
// Phase 1: POST /api/2fa/enroll (no body) → server returns QR + secret
// Phase 2: user scans QR in Authenticator → enters 6-digit code →
//          POST /api/2fa/enroll { secret, code } → upgraded to full session
// ============================================================
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function TwoFAEnroll() {
  const router = useRouter();
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/2fa/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (!r.ok || !d.ok) { setError(d.error || 'Could not start enrollment'); return; }
      setQr(d.qr); setSecret(d.secret);
    })();
  }, []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await fetch('/api/2fa/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, code }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Verification failed');
      router.push('/portal');
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <Head><title>Pushpak · Enable 2FA</title></Head>
      <main style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(180deg, #1A3F7E, #0F2855)', color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <form onSubmit={confirm} style={{
          background: '#fff', color: '#0F2855',
          padding: 32, borderRadius: 14, minWidth: 420, maxWidth: 460, width: '100%',
          boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Set up 2-factor authentication</h1>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
            Owner and Admin accounts require 2FA. Scan the QR with Google Authenticator or Authy, then enter the 6-digit code.
          </p>
          {qr ? (
            <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
              <img src={qr} alt="2FA QR code" style={{ width: 200, height: 200 }} />
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 8 }}>
                or type the secret manually: <code style={{ fontFamily: 'monospace', background: '#F4F6FA', padding: '2px 6px', borderRadius: 4 }}>{secret}</code>
              </div>
            </div>
          ) : <div style={{ padding: '20px 0', color: '#64748B', textAlign: 'center' }}>Generating code…</div>}

          <label style={{ fontSize: 11, letterSpacing: '.32em', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: 6 }}>6-DIGIT CODE</label>
          <input
            inputMode="numeric" maxLength={6} value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 18, fontWeight: 600, letterSpacing: '.3em', textAlign: 'center', background: '#FAFAFA' }}
            required
          />
          {error && <div style={{ color: '#B5483D', fontSize: 12.5, margin: '8px 0' }}>{error}</div>}
          <button type="submit" disabled={busy || code.length !== 6} style={{ marginTop: 16, width: '100%', padding: '14px 18px', background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer', opacity: busy ? .6 : 1 }}>
            {busy ? 'Verifying…' : 'Confirm & Continue'}
          </button>
        </form>
      </main>
    </>
  );
}
