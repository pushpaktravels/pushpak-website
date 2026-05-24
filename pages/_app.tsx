// ============================================================
// Next.js custom App — wraps every page.
// Loads the global stylesheet and applies it everywhere.
// ============================================================
import type { AppProps } from 'next/app';
import '../styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
