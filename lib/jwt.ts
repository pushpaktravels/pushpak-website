// ============================================================
// JWT — short-lived access token signed with HS256.
// Stored in an HttpOnly cookie so XSS can't steal it.
// Long-lived refresh tokens live in DB (RefreshToken table).
// ============================================================
import { SignJWT, jwtVerify } from 'jose';

const SECRET = process.env.JWT_SECRET || '';
if (!SECRET) throw new Error('JWT_SECRET is not set in environment');
const KEY = new TextEncoder().encode(SECRET);

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;       // 15 min
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600; // 7 days

export type AccessClaims = {
  sub: string;       // user id (cuid)
  execId: string;    // for quick logging
  role: string;
  // 2FA pass state — if true, the user has completed 2FA this session.
  // If false, they only have a "half-logged-in" token that can hit
  // /api/2fa/verify but nothing else.
  mfa: boolean;
};

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT(claims as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .setIssuer('pushpak-portal')
    .setAudience('pushpak-portal')
    .sign(KEY);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, KEY, {
      issuer: 'pushpak-portal',
      audience: 'pushpak-portal',
    });
    return payload as AccessClaims;
  } catch {
    return null;
  }
}
