// ============================================================
// GET  /api/settings — list all Setting key/value pairs.
// PATCH /api/settings  — update one or many settings.
// ============================================================
// Owner/admin only. The PATCH body is { updates: [{key, value}, ...] }
// so callers can save multiple edits in one round-trip.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, withTransaction } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';

const PatchBody = z.object({
  updates: z.array(z.object({
    key: z.string().min(1).max(120),
    value: z.string().max(1000),
  })).min(1).max(100),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  if (req.method === 'GET') {
    try {
      const rows = await query<any>(
        `SELECT key, value, category, "updatedAt", "updatedBy"
         FROM "Setting"
         ORDER BY category ASC, key ASC`,
        []
      );
      return res.json({ ok: true, data: { settings: rows } });
    } catch (err: any) {
      console.error('[api/settings GET] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Settings query failed' });
    }
  }

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });

    try {
      await withTransaction(async (q) => {
        for (const u of parsed.data.updates) {
          await q(
            `INSERT INTO "Setting" (key, value, category, "updatedAt", "updatedBy")
             VALUES ($1, $2, 'misc', NOW(), $3)
             ON CONFLICT (key) DO UPDATE
               SET value = EXCLUDED.value,
                   "updatedAt" = NOW(),
                   "updatedBy" = EXCLUDED."updatedBy"`,
            [u.key, u.value, user.name]
          );
        }
      });

      audit(req, user, 'SETTINGS_UPDATE', null, { updates: parsed.data.updates });

      return res.json({ ok: true, updated: parsed.data.updates.length });
    } catch (err: any) {
      console.error('[api/settings PATCH] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Settings update failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
