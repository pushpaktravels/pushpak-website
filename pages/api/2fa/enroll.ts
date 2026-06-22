// ============================================================
// POST /api/2fa/enroll
// ============================================================
// Two-phase TOTP enrollment:
//   Phase 1: no body → generate a secret, return QR code data URL. Don't save yet.
//   Phase 2: body { secret, code } → verify the code matches the secret, then save.
// This way an interrupted enrollment doesn't lock the user out.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { generateTotpSecret, buildTotpQr, verifyTotp } from '@/lib/totp';
import { signAccessToken } from '@/lib/jwt';
import { setAuthCookies } from '@/lib/cookies';
import { audit } from '@/lib/audit';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  // Allow half-token (mfa=false) here — enrollment is exactly when we promote them.
  const user = await requireAuth(req, res, { requireMfa: false });
  if (!user) return;

  // Re-enrollment guard. First-time enrollment legitimately runs on a
  // half-token (mfa=false) — that's how a new user gets promoted. But if a
  // TOTP is ALREADY set, a half-token caller has only proven the PASSWORD,
  // not possession of the existing authenticator. Letting them enroll a fresh
  // secret would overwrite the victim's 2FA and bypass it outright. So once
  // enrolled, only a caller who has already satisfied 2FA this session
  // (_mfaPassed) may rotate the secret; otherwise the owner must reset it.
  if (user.totpEnrolledAt && !user._mfaPassed) {
    return res.status(403).json({
      ok: false,
      error: 'Two-factor is already set up on this account. Sign in with your current 6-digit code to change it, or ask the owner to reset it.',
    });
  }

  const body = req.body || {};

  // ── Phase 1: generate a secret + QR ────────────────────────
  if (!body.code) {
    const secret = generateTotpSecret();
    const qr = await buildTotpQr(user.execId, secret);
    // We return the secret to the client — they show the QR, the user
    // scans it, then sends back { secret, code } to confirm.
    return res.json({ ok: true, phase: 'show-qr', secret, qr });
  }

  // ── Phase 2: confirm the code matches ──────────────────────
  const ConfirmSchema = z.object({
    secret: z.string().min(16).max(64),
    code: z.string().min(6).max(8),
  });
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
  const { secret, code } = parsed.data;

  if (!verifyTotp(secret, code)) {
    return res.status(401).json({ ok: false, error: 'Incorrect code. Try the next 6-digit code.' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: secret, totpEnrolledAt: new Date() },
  });

  // Now re-issue a FULL-MFA access token so they continue without re-login
  const accessToken = await signAccessToken({
    sub: user.id, execId: user.execId, role: user.role, mfa: true,
  });
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      userAgent: (req.headers['user-agent'] || '').slice(0, 500),
      ip: req.headers['x-forwarded-for']?.toString() || '',
    },
  });
  setAuthCookies(res, accessToken, refreshToken);

  await audit(req, user, '2FA_ENROLL', user.execId);
  return res.json({ ok: true, phase: 'enrolled' });
}
