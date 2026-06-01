// ============================================================
// /api/role-defaults
//   GET   — current default view-access for every role (owner only)
//   PATCH — set one role's default views: { role, views: string[] }
// ============================================================
// Owner-only governance. Saving applies LIVE to everyone on that role
// who doesn't have their own per-user viewPerms (those still win). The
// change is stored in the Setting table (category 'roledefaults') and
// the in-process cache is busted so the very next request sees it.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { ROLE_SLUGS } from '@/lib/roles';
import { VIEW_KEYS } from '@/lib/views';
import { effectiveRoleDefaults, roleDefaultKey, bustRoleDefaultsCache } from '@/lib/roledefaults';
import { ensureRoleDefaultsLoaded } from '@/lib/roledefaults-server';

const PatchBody = z.object({
  role: z.string().min(1),
  views: z.array(z.string()).max(200),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  // Owner-only — this is the same surface as Users & Authorities.
  if (!requireRole(user, res, 'owner')) return;

  if (req.method === 'GET') {
    return res.json({ ok: true, defaults: effectiveRoleDefaults() });
  }

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });

    const role = parsed.data.role;
    if (!ROLE_SLUGS.includes(role as any)) {
      return res.status(400).json({ ok: false, error: 'Unknown role' });
    }
    // Keep only real, known view keys, de-duplicated.
    const validKeys = new Set(VIEW_KEYS);
    const views = Array.from(new Set(parsed.data.views.filter(k => validKeys.has(k))));

    const before = effectiveRoleDefaults()[role] || [];

    try {
      await query(
        `INSERT INTO "Setting" (key, value, category, "updatedAt", "updatedBy")
         VALUES ($1, $2, 'roledefaults', NOW(), $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               "updatedAt" = NOW(),
               "updatedBy" = EXCLUDED."updatedBy"`,
        [roleDefaultKey(role), JSON.stringify(views), user.name]
      );
      bustRoleDefaultsCache();
      await ensureRoleDefaultsLoaded();

      audit(req, user, 'ROLE_DEFAULTS_UPDATE', role, {
        role,
        from: before,
        to: views,
      });

      return res.json({ ok: true, defaults: effectiveRoleDefaults() });
    } catch (err: any) {
      console.error('[api/role-defaults PATCH] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Save failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
