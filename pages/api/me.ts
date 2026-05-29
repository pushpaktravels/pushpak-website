// ============================================================
// GET /api/me — return the current user (or 401 if not signed in)
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  return res.json({
    ok: true,
    user: {
      id: user.id, execId: user.execId, name: user.name, role: user.role, badge: user.badge,
      team: user.team, scoreboard: user.scoreboard,
      viewPerms: user.viewPerms, viewReadOnly: user.viewReadOnly,
      // So the shell can force a password change before letting the
      // user do anything else (set by the owner in Users & Authorities).
      mustChangePassword: !!(user as any).mustChangePassword,
    },
  });
}
