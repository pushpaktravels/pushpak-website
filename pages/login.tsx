// ============================================================
// Login page (foundation version — will be replaced by the ported
// Page-v2.html UI in Phase 4). For now: enough to test end-to-end.
// ============================================================
import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Login() {
  const router = useRouter();
  const [execId, setExecId] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [step, setStep] = useState<'creds' | 'totp' | 'enroll'>('creds');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execId, password, totp: totp || undefined }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Sign-in failed');
      if (d.enrollmentRequired) { setStep('enroll'); router.push('/2fa-enroll'); return; }
      if (d.needsTotp) { setStep('totp'); return; }
      router.push('/portal');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head><title>Pushpak · Sign in</title></Head>
      <main style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(180deg, #1A3F7E, #0F2855)', color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <form onSubmit={submit} style={{
          background: 'rgba(255,255,255,0.92)', color: '#0F2855',
          padding: 32, borderRadius: 14, minWidth: 360, maxWidth: 420, width: '100%',
          boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
        }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 6, textAlign: 'center' }}>Welcome back</h1>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 22, textAlign: 'center' }}>
            {step === 'totp' ? 'Enter the 6-digit code from your authenticator app' : 'Sign in to continue to your worklist'}
          </p>

          {step === 'creds' && (
            <>
              <label style={lbl}>EXECUTIVE ID</label>
              <input style={inp} value={execId} onChange={e => setExecId(e.target.value.toUpperCase())} autoFocus required />
              <label style={lbl}>PASSWORD</label>
              <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </>
          )}

          {step === 'totp' && (
            <>
              <label style={lbl}>2FA CODE</label>
              <input style={inp} inputMode="numeric" maxLength={6} value={totp} onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus required />
            </>
          )}

          {error && <div style={{ color: '#B5483D', fontSize: 12.5, margin: '8px 0' }}>{error}</div>}

          <button type="submit" disabled={busy} style={btn}>
            {busy ? 'Signing in…' : (step === 'totp' ? 'Verify' : 'Sign In →')}
          </button>
        </form>
      </main>
    </>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, letterSpacing: '.32em', color: '#64748B', fontWeight: 600, display: 'block', marginTop: 14, marginBottom: 6 };
const inp: React.CSSProperties = { width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 15, fontWeight: 600, color: '#0F2855', background: '#FAFAFA' };
const btn: React.CSSProperties = { marginTop: 22, width: '100%', padding: '14px 18px', background: 'linear-gradient(180deg,#1A3F7E,#0F2855)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer' };
