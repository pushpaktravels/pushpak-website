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
import { bustPolicyCache } from '@/lib/policy';

const PatchBody = z.object({
  updates: z.array(z.object({
    key: z.string().min(1).max(120),
    value: z.string().max(1000),
    // Only consulted when CREATING a brand-new key; updates to an
    // existing key never touch its category.
    category: z.string().min(1).max(60).optional(),
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
      // Snapshot current values FIRST so we can record a precise
      // old → new diff in the audit log ("who changed the lockout
      // threshold, and from what to what?").
      const keys = parsed.data.updates.map(u => u.key);
      const existingRows = await query<{ key: string; value: string; category: string }>(
        `SELECT key, value, category FROM "Setting" WHERE key = ANY($1)`,
        [keys]
      );
      const existing = new Map(existingRows.map(r => [r.key, r]));

      await withTransaction(async (q) => {
        for (const u of parsed.data.updates) {
          const prior = existing.get(u.key);
          // New keys take the supplied category (or 'misc'); updates to
          // an existing key keep whatever category it already has —
          // never silently re-bucket a known setting into 'misc'.
          const category = prior?.category ?? u.category ?? 'misc';
          await q(
            `INSERT INTO "Setting" (key, value, category, "updatedAt", "updatedBy")
             VALUES ($1, $2, $3, NOW(), $4)
             ON CONFLICT (key) DO UPDATE
               SET value = EXCLUDED.value,
                   "updatedAt" = NOW(),
                   "updatedBy" = EXCLUDED."updatedBy"`,
            [u.key, u.value, category, user.name]
          );
        }
      });

      // Per-key before/after, skipping no-op writes.
      const changes = parsed.data.updates
        .map(u => ({ key: u.key, from: existing.get(u.key)?.value ?? null, to: u.value }))
        .filter(c => c.from !== c.to);
      audit(req, user, 'SETTINGS_UPDATE', null, { changes });

      // A security-policy edit must take effect on the very next
      // request, not after the 30s policy cache expires.
      bustPolicyCache();

      return res.json({ ok: true, updated: parsed.data.updates.length });
    } catch (err: any) {
      console.error('[api/settings PATCH] error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Settings update failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
