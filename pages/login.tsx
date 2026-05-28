// ============================================================
// Login page — branded version matching the old Apps Script portal.
// ============================================================
// Layout (top → bottom on a deep navy gradient):
//   ▸ Pushpak logo + "EXECUTIVE PORTAL" subtitle
//   ▸ White card with "Welcome back" form + icons inside inputs
//   ▸ "Forgot your ID? Contact Vanshika." line under Sign In
//   ▸ John Ruskin quote at the very bottom
// Supports the existing creds → totp → enroll flow unchanged.
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
  const idleReason = router.query.reason === 'idle';

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
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 28,
        background: 'linear-gradient(180deg, #0F2855 0%, #08183A 100%)',
        color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '48px 24px',
      }}>
        {/* Top brand */}
        <div style={{ textAlign: 'center' }}>
          <img
            src="/pushpak-logo2.png"
            alt="Pushpak"
            style={{ height: 92, width: 'auto', margin: '0 auto', display: 'block' }}
          />
          <div style={{
            marginTop: 10, fontSize: 10.5, fontWeight: 600,
            letterSpacing: '.42em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.72)',
          }}>
            Executive Portal
          </div>
        </div>

        {/* Card */}
        <form onSubmit={submit} style={{
          background: 'rgba(255,255,255,0.95)', color: '#0F2855',
          padding: '30px 30px 26px', borderRadius: 16, minWidth: 320, maxWidth: 380, width: '100%',
          boxShadow: '0 30px 80px rgba(0,0,0,0.45), 0 10px 22px rgba(0,0,0,0.18)',
        }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 6, textAlign: 'center', color: '#0F2855' }}>
            Welcome back
          </h1>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 4, textAlign: 'center' }}>
            {step === 'totp' ? 'Enter the 6-digit code from your authenticator app' : 'Sign in to continue to your worklist'}
          </p>
          {/* Decorative rule under subtitle */}
          <div style={{
            width: 44, height: 2, background: '#0F2855', margin: '14px auto 22px', opacity: 0.85,
          }} />

          {step === 'creds' && (
            <>
              <Label>Executive ID</Label>
              <InputWithIcon icon={<UserIcon />} value={execId} onChange={v => setExecId(v.toUpperCase())} autoFocus required />
              <Label>Password</Label>
              <InputWithIcon icon={<LockIcon />} type="password" value={password} onChange={setPassword} required />
            </>
          )}

          {step === 'totp' && (
            <>
              <Label>2FA Code</Label>
              <InputWithIcon icon={<LockIcon />} value={totp} onChange={v => setTotp(v.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} autoFocus required />
            </>
          )}

          {idleReason && !error && (
            <div style={{
              color: '#B58430', fontSize: 12.5, margin: '10px 0', textAlign: 'center',
              padding: '8px 12px', background: 'rgba(217,165,69,.10)', borderRadius: 6,
            }}>
              You were signed out due to 30 minutes of inactivity.
            </div>
          )}
          {error && (
            <div style={{ color: '#B5483D', fontSize: 12.5, margin: '10px 0', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} style={{
            marginTop: 22, width: '100%', padding: '14px 18px',
            background: 'linear-gradient(180deg,#1A3F7E,#0F2855)',
            color: '#fff', border: 'none', borderRadius: 10,
            fontSize: 12, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}>
            {busy ? 'Signing in…' : (step === 'totp' ? 'Verify →' : 'Sign in →')}
          </button>

          <div style={{
            marginTop: 18, textAlign: 'center', fontSize: 12, color: '#64748B',
          }}>
            Forgot your ID? Contact <strong style={{ color: '#0F2855' }}>Vanshika</strong>.
          </div>
        </form>

        {/* Footer quote — sits naturally below the card now that the main container is center-justified */}
        <div style={{ textAlign: 'center', maxWidth: 520, color: 'rgba(255,255,255,0.62)' }}>
          <div style={{
            fontFamily: 'inherit', fontStyle: 'italic',
            fontSize: 14.5, lineHeight: 1.55, fontWeight: 400,
          }}>
            "Quality is never an accident; it is always the result of intelligent effort."
          </div>
          <div style={{
            marginTop: 8, fontSize: 9.5, fontWeight: 700,
            letterSpacing: '.36em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.45)',
          }}>
            — John Ruskin
          </div>
        </div>
      </main>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      fontSize: 10.5, letterSpacing: '.32em', textTransform: 'uppercase',
      color: '#64748B', fontWeight: 700, display: 'block', marginTop: 14, marginBottom: 8,
    }}>{children}</label>
  );
}

function InputWithIcon({
  icon, value, onChange, type = 'text', autoFocus, required, inputMode, maxLength,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
  required?: boolean;
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
}) {
  return (
    <div style={{ position: 'relative', marginBottom: 4 }}>
      <span style={{
        position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
        color: '#94A3B8', display: 'flex', alignItems: 'center', pointerEvents: 'none',
      }}>{icon}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
        style={{
          width: '100%', padding: '13px 14px 13px 42px',
          borderRadius: 10, border: '1px solid #E5E7EB',
          fontSize: 15, fontWeight: 600, color: '#0F2855',
          background: '#FAFAFA', outline: 'none',
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = '#1A3F7E';
          e.currentTarget.style.background = '#fff';
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = '#E5E7EB';
          e.currentTarget.style.background = '#FAFAFA';
        }}
      />
    </div>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
