// ============================================================
// GET /api/me — return the current user (or 401 if not signed in)
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/lib/auth';
import { effectiveRoleDefaults } from '@/lib/roledefaults';
import { getSecurityPolicy } from '@/lib/policy';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  const policy = await getSecurityPolicy().catch(() => null);
  return res.json({
    ok: true,
    user: {
      id: user.id, execId: user.execId, name: user.name, role: user.role, badge: user.badge,
      team: user.team, scoreboard: user.scoreboard,
      viewPerms: user.viewPerms, viewReadOnly: user.viewReadOnly,
      // Live, owner-editable default views for this user's role. The
      // sidebar uses this (for users without their own viewPerms) so the
      // nav matches the server gate when a role default changes.
      roleViews: effectiveRoleDefaults()[user.role] || [],
      // Owner-tunable idle auto-logout (minutes). The shell's idle timer
      // reads this instead of a hardcoded constant, so SESSION_IDLE_MINUTES
      // in /portal/settings actually takes effect.
      sessionIdleMinutes: policy?.sessionIdleMinutes ?? 30,
      // So the shell can force a password change before letting the
      // user do anything else (set by the owner in Users & Authorities).
      mustChangePassword: !!(user as any).mustChangePassword,
    },
  });
}
