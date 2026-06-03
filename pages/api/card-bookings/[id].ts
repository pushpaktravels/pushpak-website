// ============================================================
// /api/card-bookings/[id] — update / mark-billed / delete a card log row.
// ============================================================
// PATCH  → edit fields, OR flip the billing handoff:
//          { action: 'bill' }   → status='billed', stamps who/when (accounts)
//          { action: 'unbill' } → back to 'unbilled' (undo)
//          { action: 'cancel' } → status='cancelled'
//          otherwise → edit the logged details (amount/purpose/pnr/…)
// DELETE → remove a log row (owner/admin only — keep an honest trail).
//
// Portal-only, never touches FinBook. View-edit on 'card-log'.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { CARD_KEYS, CARD_PURPOSES } from '@/lib/cards';

const PatchBody = z.object({
  action:        z.enum(['bill', 'unbill', 'cancel']).optional(),
  cardKey:       z.enum(CARD_KEYS as [string, ...string[]]).optional(),
  amount:        z.coerce.number().min(0).max(1e9).optional(),
  purpose:       z.enum(CARD_PURPOSES as unknown as [string, ...string[]]).optional(),
  passengerName: z.string().max(200).optional().nullable(),
  pnr:           z.string().max(20).optional().nullable(),
  airline:       z.string().max(80).optional().nullable(),
  clientName:    z.string().max(200).optional().nullable(),
  txnDate:       z.string().optional().nullable(),
  notes:         z.string().max(2000).optional().nullable(),
});

const COLUMN: Record<string, string> = {
  cardKey: '"cardKey"', amount: 'amount', purpose: 'purpose',
  passengerName: '"passengerName"', pnr: 'pnr', airline: 'airline',
  clientName: '"clientName"', txnDate: '"txnDate"', notes: 'notes',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!requireView(user, res, 'card-log')) return;
  if (!requireViewEdit(user, res, 'card-log')) return;

  const existing = await queryOne<any>(`SELECT * FROM "CardBooking" WHERE id = $1 LIMIT 1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Card booking not found' });

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete a card log entry' });
    }
    try {
      await query(`DELETE FROM "CardBooking" WHERE id = $1`, [id]);
      audit(req, user, 'CARD_BOOKING_DELETE', existing.passengerName || existing.pnr || id, { id });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[api/card-bookings/[id]] delete error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Delete failed' });
    }
  }

  // PATCH
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  try {
    // Billing-handoff actions take priority and are explicit.
    if (b.action === 'bill') {
      await query(
        `UPDATE "CardBooking" SET status='billed', "billedByExecId"=$2, "billedByName"=$3, "billedAt"=NOW(), "updatedAt"=NOW() WHERE id=$1`,
        [id, user.execId, user.name]
      );
      audit(req, user, 'CARD_BOOKING_BILLED', existing.passengerName || existing.pnr || id, { id, amount: existing.amount });
    } else if (b.action === 'unbill') {
      await query(
        `UPDATE "CardBooking" SET status='unbilled', "billedByExecId"=NULL, "billedByName"=NULL, "billedAt"=NULL, "updatedAt"=NOW() WHERE id=$1`,
        [id]
      );
      audit(req, user, 'CARD_BOOKING_UNBILLED', existing.passengerName || existing.pnr || id, { id });
    } else if (b.action === 'cancel') {
      await query(`UPDATE "CardBooking" SET status='cancelled', "updatedAt"=NOW() WHERE id=$1`, [id]);
      audit(req, user, 'CARD_BOOKING_CANCEL', existing.passengerName || existing.pnr || id, { id });
    } else {
      // Field edits.
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      for (const [key, col] of Object.entries(COLUMN)) {
        if (!(key in b)) continue;
        let val: any = (b as any)[key];
        if (key === 'txnDate') {
          if (!val) { return res.status(400).json({ ok: false, error: 'Transaction date cannot be empty' }); }
          const d = new Date(val);
          if (isNaN(d.getTime())) return res.status(400).json({ ok: false, error: 'Invalid transaction date' });
          val = d.toISOString();
        }
        if (key === 'passengerName' || key === 'pnr' || key === 'airline' || key === 'clientName' || key === 'notes') {
          val = val || null;
        }
        sets.push(`${col} = $${i++}`);
        params.push(val);
      }
      if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Nothing to update' });
      sets.push(`"updatedAt" = NOW()`);
      params.push(id);
      await query(`UPDATE "CardBooking" SET ${sets.join(', ')} WHERE id = $${i}`, params);
      audit(req, user, 'CARD_BOOKING_UPDATE', existing.passengerName || existing.pnr || id, { id, changed: Object.keys(b) });
    }

    const row = await queryOne<any>(`SELECT * FROM "CardBooking" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { booking: row } });
  } catch (err: any) {
    console.error('[api/card-bookings/[id]] patch error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Update failed' });
  }
}
