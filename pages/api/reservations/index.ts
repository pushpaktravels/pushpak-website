// ============================================================
// /api/reservations — Domestic Reservations list + create.
// ============================================================
// GET  ?scope=all|dues|mine&q=<search>&status=<Held|Ticketed|Cancelled>
//   • all  → every booking            (view: reservations)
//   • dues → outstanding balance > 0  (view: reservations-dues)
//   • mine → the caller's own bookings(view: reservations-worklist)
// POST  → create a booking (view-edit: reservations)
//
// Stand-alone module — no Account/Client join yet. The creating user
// becomes the owning agent (agentExecId), which drives "My Worklist".
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const STATUSES = ['Held', 'Ticketed', 'Cancelled'] as const;

const CreateBody = z.object({
  passengerName:   z.string().min(1).max(200),
  paxCount:        z.coerce.number().int().min(1).max(50).default(1),
  contact:         z.string().max(100).optional().nullable(),
  sector:          z.string().min(1).max(120),
  airline:         z.string().max(80).optional().nullable(),
  travelDate:      z.string().optional().nullable(),     // ISO date string
  fareAmount:      z.coerce.number().min(0).max(1e9).default(0),
  amountCollected: z.coerce.number().min(0).max(1e9).default(0),
  vendor:          z.string().max(120).optional().nullable(),
  pnr:             z.string().max(20).optional().nullable(),
  status:          z.enum(STATUSES).default('Held'),
  notes:           z.string().max(2000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') return list(req, res, user);
  if (req.method === 'POST') return create(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse, user: any) {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';

  // Gate on the view that backs the page making the request, so the
  // owner's per-user grants narrow each surface independently.
  const viewForScope = scope === 'dues' ? 'reservations-dues'
                     : scope === 'mine' ? 'reservations-worklist'
                     : 'reservations';
  if (!requireView(user, res, viewForScope)) return;

  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (scope === 'mine') {
    conditions.push(`"agentExecId" = $${i++}`);
    params.push(user.execId);
    conditions.push(`status <> 'Cancelled'`);
  } else if (scope === 'dues') {
    conditions.push(`status <> 'Cancelled'`);
    conditions.push(`("fareAmount" - "amountCollected") > 0`);
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && (STATUSES as readonly string[]).includes(status)) {
    conditions.push(`status = $${i++}`);
    params.push(status);
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    conditions.push(`(
      "passengerName" ILIKE $${i} OR
      COALESCE("pnr", '')     ILIKE $${i} OR
      "sector"        ILIKE $${i} OR
      COALESCE("airline", '') ILIKE $${i} OR
      COALESCE("agentName",'')ILIKE $${i}
    )`);
    params.push(`%${q}%`);
    i++;
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Held first (need ticketing), then by soonest travel date.
  const orderSql = scope === 'mine' || scope === 'dues'
    ? `ORDER BY "travelDate" ASC NULLS LAST, "createdAt" DESC`
    : `ORDER BY "createdAt" DESC`;

  try {
    const rows = await query<any>(`SELECT * FROM "Reservation" ${whereSql} ${orderSql}`, params);
    return res.json({ ok: true, data: { reservations: rows } });
  } catch (err: any) {
    console.error('[api/reservations] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Reservations query failed' });
  }
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireView(user, res, 'reservations')) return;
  if (!requireViewEdit(user, res, 'reservations')) return;

  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  if (b.amountCollected > b.fareAmount) {
    return res.status(400).json({ ok: false, error: 'Collected amount cannot exceed the fare' });
  }

  const id = newId('rsv');
  const travelDate = b.travelDate ? new Date(b.travelDate) : null;
  if (travelDate && isNaN(travelDate.getTime())) {
    return res.status(400).json({ ok: false, error: 'Invalid travel date' });
  }

  try {
    await query(
      `INSERT INTO "Reservation"
        (id, pnr, "passengerName", "paxCount", contact, sector, airline,
         "travelDate", "fareAmount", "amountCollected", vendor, status, notes,
         "agentExecId", "agentName", "createdBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())`,
      [
        id, b.pnr || null, b.passengerName, b.paxCount, b.contact || null,
        b.sector, b.airline || null, travelDate ? travelDate.toISOString() : null,
        b.fareAmount, b.amountCollected, b.vendor || null, b.status, b.notes || null,
        user.execId, user.name, user.execId,
      ]
    );

    audit(req, user, 'RESERVATION_CREATE', b.passengerName, {
      id, sector: b.sector, fare: b.fareAmount, status: b.status,
    });

    const row = await queryOne<any>(`SELECT * FROM "Reservation" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { reservation: row } });
  } catch (err: any) {
    console.error('[api/reservations] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Create reservation failed' });
  }
}
