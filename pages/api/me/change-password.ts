// ============================================================
// POST /api/me/change-password — self-service password change.
// Body: { currentPassword: string, newPassword: string }
// ============================================================
// Any signed-in user can rotate their own password here. This is
// also the screen a user lands on when the owner has set
// mustChangePassword — succeeding here clears that flag.
//
// Verifies the current password, enforces the live password policy
// (lib/policy.ts), forbids reusing the same password, then rotates
// the hash and clears any lockout. Never logs plaintext.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { validatePassword } from '@/lib/policy';
import { audit } from '@/lib/audit';

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
  const { currentPassword, newPassword } = parsed.data;

  try {
    // Verify the CURRENT password against the stored hash. requireAuth
    // returns the full row (SELECT *), so passwordHash is present.
    const ok = await verifyPassword((user as any).passwordHash, currentPassword);
    if (!ok) {
      await audit(req, user, 'PASSWORD_CHANGE_FAIL', user.execId, { reason: 'bad_current' });
      return res.status(401).json({ ok: false, error: 'Current password is incorrect' });
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({ ok: false, error: 'New password must be different from the current one' });
    }

    const pwErr = await validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ ok: false, error: pwErr });

    const hash = await hashPassword(newPassword);
    await query(
      `UPDATE "User"
          SET "passwordHash" = $1,
              "passwordChangedAt" = NOW(),
              "mustChangePassword" = false,
              "failedAttempts" = 0,
              "lockedUntil" = NULL,
              "updatedAt" = NOW()
        WHERE id = $2`,
      [hash, user.id]
    );

    await audit(req, user, 'PASSWORD_CHANGE_SELF', user.execId);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[api/me/change-password] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Password change failed' });
  }
}
