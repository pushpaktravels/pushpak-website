// ============================================================
// /api/card-bookings — credit-card booking log: list + create.
// ============================================================
// The portal replacement for the OTP Google Form + its response Excel.
// GET  ?scope=all|mine|unbilled & card=<key> & status=<...> & q=<search>
//   • all      → every logged card payment
//   • mine     → the ones the caller logged
//   • unbilled → the accounts work queue (status = 'unbilled')
// POST → log a new card payment (the booker, right after booking).
//
// Portal-only: this never touches FinBook. Gated on the 'card-log' view.
// We store no OTP and no card number — only which firm card (cardKey).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { CARD_KEYS, CARD_PURPOSES } from '@/lib/cards';

const CreateBody = z.object({
  cardKey:       z.enum(CARD_KEYS as [string, ...string[]]),
  amount:        z.coerce.number().min(0).max(1e9).default(0),
  purpose:       z.enum(CARD_PURPOSES as unknown as [string, ...string[]]).default('ticket'),
  passengerName: z.string().max(200).optional().nullable(),
  pnr:           z.string().max(20).optional().nullable(),
  airline:       z.string().max(80).optional().nullable(),
  clientName:    z.string().max(200).optional().nullable(),
  department:    z.string().max(60).optional().nullable(),
  txnDate:       z.string().optional().nullable(),  // ISO; defaults to now
  notes:         z.string().max(2000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'card-log')) return;

  if (req.method === 'GET') return list(req, res, user);
  if (req.method === 'POST') return create(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse, user: any) {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (scope === 'mine') { conditions.push(`"bookedByExecId" = $${i++}`); params.push(user.execId); }
  else if (scope === 'unbilled') { conditions.push(`status = 'unbilled'`); }

  const card = typeof req.query.card === 'string' ? req.query.card : '';
  if (card && CARD_KEYS.includes(card)) { conditions.push(`"cardKey" = $${i++}`); params.push(card); }

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && ['unbilled', 'billed', 'cancelled'].includes(status)) { conditions.push(`status = $${i++}`); params.push(status); }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    conditions.push(`(
      COALESCE("passengerName",'') ILIKE $${i} OR
      COALESCE("pnr",'')           ILIKE $${i} OR
      COALESCE("clientName",'')    ILIKE $${i} OR
      COALESCE("airline",'')       ILIKE $${i} OR
      COALESCE("bookedByName",'')  ILIKE $${i}
    )`);
    params.push(`%${q}%`); i++;
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const rows = await query<any>(
      `SELECT * FROM "CardBooking" ${whereSql} ORDER BY "txnDate" DESC, "createdAt" DESC LIMIT 1000`,
      params
    );
    // Unbilled totals per card — what accounts still has to invoice.
    const totals = await query<any>(
      `SELECT "cardKey", COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total
         FROM "CardBooking" WHERE status = 'unbilled' GROUP BY "cardKey"`
    );
    return res.json({ ok: true, data: { bookings: rows, unbilledByCard: totals } });
  } catch (err: any) {
    console.error('[api/card-bookings] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Card bookings query failed' });
  }
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireViewEdit(user, res, 'card-log')) return;

  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const txnDate = b.txnDate ? new Date(b.txnDate) : new Date();
  if (isNaN(txnDate.getTime())) return res.status(400).json({ ok: false, error: 'Invalid transaction date' });

  const id = newId('card');
  try {
    await query(
      `INSERT INTO "CardBooking"
        (id, "cardKey", amount, purpose, "passengerName", pnr, airline, "clientName",
         department, "txnDate", status, "bookedByExecId", "bookedByName", notes,
         "createdBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unbilled',$11,$12,$13,$14,NOW(),NOW())`,
      [
        id, b.cardKey, b.amount, b.purpose, b.passengerName || null, b.pnr || null,
        b.airline || null, b.clientName || null, b.department || user.role || null,
        txnDate.toISOString(), user.execId, user.name, b.notes || null, user.execId,
      ]
    );
    audit(req, user, 'CARD_BOOKING_CREATE', b.passengerName || b.pnr || b.cardKey, {
      id, cardKey: b.cardKey, amount: b.amount, purpose: b.purpose,
    });
    const row = await queryOne<any>(`SELECT * FROM "CardBooking" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { booking: row } });
  } catch (err: any) {
    console.error('[api/card-bookings] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Create card booking failed' });
  }
}
