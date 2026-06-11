// ============================================================
// /api/vendors/[id] — edit or deactivate one vendor.
// ============================================================
//   PATCH {name?, contact?, gstin?, notes?, active?}  → update the master row.
//   (No hard delete: a vendor may already be referenced by a booking / payment,
//    so we deactivate instead — active:false hides it from the default picker
//    but keeps history intact. Re-activate with active:true.)
//
// Same desks that can grow the master can maintain it (vendor-pay / bookings).
// Portal-only; nothing here touches FinBook.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, canEditView } from '@/lib/views';
import { audit } from '@/lib/audit';

const EDIT_VIEWS = ['vendor-pay', 'reservations', 'card-log'];

const PatchBody = z.object({
  name:    z.string().min(1).max(120).transform(s => s.trim()).optional(),
  contact: z.string().max(120).optional().nullable(),
  gstin:   z.string().max(40).optional().nullable(),
  notes:   z.string().max(2000).optional().nullable(),
  active:  z.boolean().optional(),
});

const COLUMN: Record<string, string> = {
  name: 'name', contact: 'contact', gstin: 'gstin', notes: 'notes', active: 'active',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'query-fill')) return;        // broad read gate (excludes insights-only)
  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!EDIT_VIEWS.some(v => canEditView(user, v))) {
    return res.status(403).json({ ok: false, error: 'Not allowed to edit a vendor' });
  }

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const existing = await queryOne<any>(`SELECT * FROM "Vendor" WHERE id = $1 LIMIT 1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Vendor not found' });

  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  // If the name is changing, guard the case-insensitive uniqueness ourselves so
  // we return a friendly error instead of a raw 23505 from the unique index.
  if (b.name && b.name.toLowerCase() !== String(existing.name).toLowerCase()) {
    const clash = await queryOne<any>(`SELECT id FROM "Vendor" WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`, [b.name, id]);
    if (clash) return res.status(409).json({ ok: false, error: 'Another vendor already has that name' });
  }

  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  for (const [key, col] of Object.entries(COLUMN)) {
    if (!(key in b)) continue;
    let val: any = (b as any)[key];
    if (key === 'contact' || key === 'gstin' || key === 'notes') val = val || null;
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Nothing to update' });

  sets.push(`"updatedAt" = NOW()`);
  params.push(id);

  try {
    await query(`UPDATE "Vendor" SET ${sets.join(', ')} WHERE id = $${i}`, params);
    const row = await queryOne<any>(`SELECT id, name, contact, gstin, notes, active FROM "Vendor" WHERE id = $1`, [id]);
    audit(req, user, 'VENDOR_UPDATE', existing.name, { id, changed: Object.keys(b) });
    return res.json({ ok: true, vendor: row });
  } catch (err: any) {
    console.error('[api/vendors/[id]] patch error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Update vendor failed' });
  }
}
