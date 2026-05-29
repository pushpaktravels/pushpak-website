// ============================================================
// /api/reservations/[id] — update or delete a booking.
// ============================================================
// PATCH  → edit any booking field (record a payment, issue a ticket,
//          cancel, fix details). View-edit on 'reservations'.
// DELETE → remove a booking entirely. View-edit on 'reservations'.
//
// All fields optional on PATCH; only the keys present are changed.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const STATUSES = ['Held', 'Ticketed', 'Cancelled'] as const;

const PatchBody = z.object({
  passengerName:   z.string().min(1).max(200).optional(),
  paxCount:        z.coerce.number().int().min(1).max(50).optional(),
  contact:         z.string().max(100).optional().nullable(),
  sector:          z.string().min(1).max(120).optional(),
  airline:         z.string().max(80).optional().nullable(),
  travelDate:      z.string().optional().nullable(),
  fareAmount:      z.coerce.number().min(0).max(1e9).optional(),
  amountCollected: z.coerce.number().min(0).max(1e9).optional(),
  vendor:          z.string().max(120).optional().nullable(),
  pnr:             z.string().max(20).optional().nullable(),
  status:          z.enum(STATUSES).optional(),
  notes:           z.string().max(2000).optional().nullable(),
});

// Map a body key → its DB column (so we control exactly what's writable).
const COLUMN: Record<string, string> = {
  passengerName:   '"passengerName"',
  paxCount:        '"paxCount"',
  contact:         'contact',
  sector:          'sector',
  airline:         'airline',
  travelDate:      '"travelDate"',
  fareAmount:      '"fareAmount"',
  amountCollected: '"amountCollected"',
  vendor:          'vendor',
  pnr:             'pnr',
  status:          'status',
  notes:           'notes',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!requireView(user, res, 'reservations')) return;
  if (!requireViewEdit(user, res, 'reservations')) return;

  const existing = await queryOne<any>(`SELECT * FROM "Reservation" WHERE id = $1 LIMIT 1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Reservation not found' });

  if (req.method === 'DELETE') {
    try {
      await query(`DELETE FROM "Reservation" WHERE id = $1`, [id]);
      audit(req, user, 'RESERVATION_DELETE', existing.passengerName, { id, sector: existing.sector });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[api/reservations/[id]] delete error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Delete failed' });
    }
  }

  // PATCH
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;

  for (const [key, col] of Object.entries(COLUMN)) {
    if (!(key in b)) continue;
    let val: any = (b as any)[key];
    if (key === 'travelDate') {
      if (val) {
        const d = new Date(val);
        if (isNaN(d.getTime())) return res.status(400).json({ ok: false, error: 'Invalid travel date' });
        val = d.toISOString();
      } else {
        val = null;
      }
    }
    if (key === 'contact' || key === 'airline' || key === 'vendor' || key === 'pnr' || key === 'notes') {
      val = val || null;
    }
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }

  if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Nothing to update' });

  // Guard: collected must not exceed fare after the merge.
  const nextFare = b.fareAmount ?? Number(existing.fareAmount);
  const nextColl = b.amountCollected ?? Number(existing.amountCollected);
  if (nextColl > nextFare) {
    return res.status(400).json({ ok: false, error: 'Collected amount cannot exceed the fare' });
  }

  sets.push(`"updatedAt" = NOW()`);
  params.push(id);

  try {
    await query(`UPDATE "Reservation" SET ${sets.join(', ')} WHERE id = $${i}`, params);
    audit(req, user, 'RESERVATION_UPDATE', existing.passengerName, { id, changed: Object.keys(b) });
    const row = await queryOne<any>(`SELECT * FROM "Reservation" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { reservation: row } });
  } catch (err: any) {
    console.error('[api/reservations/[id]] patch error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Update failed' });
  }
}
