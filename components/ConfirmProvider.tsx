// ============================================================
// ConfirmProvider — portal-styled replacement for window.confirm().
// ============================================================
// Mount <ConfirmProvider> once in _app.tsx; anywhere inside it, call
// the useConfirm() hook to get an async `confirm(opts)` function
// that returns Promise<boolean>. The modal renders centered on a
// dimmed backdrop and matches the rest of the portal's styling
// (navy primary, soft paper background, gold focus rings).
//
// Usage:
//   const confirm = useConfirm();
//   if (!await confirm({ title: 'Delete file?', body: '...' })) return;
//   ... proceed ...
//
// Options:
//   title         (required)
//   body          (optional ReactNode)
//   confirmLabel  (default "Confirm")
//   cancelLabel   (default "Cancel")
//   destructive   bool — confirm button uses the rust palette
// ============================================================
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Resolver = (ok: boolean) => void;

const ConfirmCtx = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const fn = useContext(ConfirmCtx);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<Resolver | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(o);
    });
  }, []);

  function close(answer: boolean) {
    const r = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    r?.(answer);
  }

  // Esc closes (as Cancel)
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts]);

  const destructive = opts?.destructive;

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <div
          onClick={() => close(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(15,40,85,0.42)',
            backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            role="dialog" aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--paper, #F8F4EC)',
              border: '1px solid rgba(15,40,85,0.10)',
              borderRadius: 16,
              boxShadow: '0 30px 80px rgba(0,0,0,0.32), 0 10px 24px rgba(0,0,0,0.18)',
              width: '100%', maxWidth: 460,
              padding: '24px 26px 20px',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            <div style={{
              fontSize: 18, fontWeight: 700, color: 'var(--ink, #0F2855)',
              lineHeight: 1.35,
            }}>
              {opts.title}
            </div>
            {opts.body && (
              <div style={{
                fontSize: 13.5, color: 'var(--ink-soft, #475569)',
                lineHeight: 1.55, whiteSpace: 'pre-wrap',
              }}>{opts.body}</div>
            )}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6,
            }}>
              <button
                onClick={() => close(false)}
                style={{
                  padding: '10px 18px', borderRadius: 8,
                  background: 'transparent', color: 'var(--ink, #0F2855)',
                  border: '1px solid rgba(15,40,85,0.22)', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: '.22em', textTransform: 'uppercase',
                  fontFamily: 'inherit',
                }}
              >{opts.cancelLabel ?? 'Cancel'}</button>
              <button
                onClick={() => close(true)}
                autoFocus
                style={{
                  padding: '10px 22px', borderRadius: 8,
                  background: destructive
                    ? 'linear-gradient(180deg,#C2563F,#9C3D2A)'
                    : 'linear-gradient(180deg,#1A3F7E,#0F2855)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: '.22em', textTransform: 'uppercase',
                  fontFamily: 'inherit',
                  boxShadow: '0 6px 18px rgba(15,40,85,0.18)',
                }}
              >{opts.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
