// ============================================================
// Cookie helpers — HttpOnly, Secure, SameSite=Strict.
// ============================================================
// HttpOnly: JS can't read the cookie → XSS can't steal the session.
// Secure: only sent over HTTPS.
// SameSite=Strict: a malicious site can't trick a logged-in user
//   into making a request (CSRF defense at the cookie layer).
// ============================================================
import type { NextApiResponse } from 'next';

const ACCESS_COOKIE = 'pp_access';
const REFRESH_COOKIE = 'pp_refresh';

function buildCookie(name: string, value: string, maxAgeSec: number): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${
    process.env.NODE_ENV === 'production' ? '; Secure' : ''
  }`;
}

export function setAuthCookies(res: NextApiResponse, accessToken: string, refreshToken: string) {
  res.setHeader('Set-Cookie', [
    buildCookie(ACCESS_COOKIE, accessToken, 15 * 60),
    buildCookie(REFRESH_COOKIE, refreshToken, 7 * 24 * 3600),
  ]);
}

export function clearAuthCookies(res: NextApiResponse) {
  res.setHeader('Set-Cookie', [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE)]);
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map(s => s.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export const COOKIE_NAMES = { ACCESS: ACCESS_COOKIE, REFRESH: REFRESH_COOKIE };
