// ============================================================
// POST /api/logout
// ============================================================
// Clears cookies + revokes the refresh token in DB so it can't be reused.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/db';
import { COOKIE_NAMES, clearAuthCookies, readCookie } from '@/lib/cookies';
import { audit } from '@/lib/audit';
import { verifyAccessToken } from '@/lib/jwt';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const access = readCookie(req.headers.cookie, COOKIE_NAMES.ACCESS);
  const refresh = readCookie(req.headers.cookie, COOKIE_NAMES.REFRESH);
  let user: any = null;
  if (access) {
    const claims = await verifyAccessToken(access);
    if (claims) user = await prisma.user.findUnique({ where: { id: claims.sub } });
  }
  if (refresh) {
    const hash = crypto.createHash('sha256').update(refresh).digest('hex');
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  clearAuthCookies(res);
  if (user) await audit(req, user, 'LOGOUT', user.execId);
  return res.json({ ok: true });
}
