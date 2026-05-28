// ============================================================
// Next.js custom App — wraps every page.
// Loads the global stylesheet and the ConfirmProvider so any
// component can call useConfirm() instead of window.confirm().
// ============================================================
import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { ConfirmProvider } from '../components/ConfirmProvider';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ConfirmProvider>
      <Component {...pageProps} />
    </ConfirmProvider>
  );
}
