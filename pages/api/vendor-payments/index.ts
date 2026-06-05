// ============================================================
// /api/vendor-payments — vendor-payment requests: list + create.
// ============================================================
// The portal replacement for the vendor-payment Google Form + Excel.
// GET  ?scope=all|mine|pending & status=<...> & q=<search>
//   • all     → every request
//   • mine    → the ones the caller raised
//   • pending → the approver queue (status = 'requested')
// POST → raise a new payment request.
//
// Portal-only: never touches FinBook. Gated on the 'vendor-pay' view.
// Approving/paying is restricted to managers (see [id].ts).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const CreateBody = z.object({
  vendorName: z.string().min(1).max(200),
  billNo:     z.string().max(60).optional().nullable(),
  amount:     z.coerce.number().min(0).max(1e9).default(0),
  purpose:    z.string().max(500).optional().nullable(),
  billDate:   z.string().optional().nullable(),
  dueDate:    z.string().optional().nullable(),
  department: z.string().max(60).optional().nullable(),
  notes:      z.string().max(2000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'vendor-pay')) return;

  if (req.method === 'GET') return list(req, res, user);
  if (req.method === 'POST') return create(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse, user: any) {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (scope === 'mine') { conditions.push(`"requestedByExecId" = $${i++}`); params.push(user.execId); }
  else if (scope === 'pending') { conditions.push(`status = 'requested'`); }

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && ['requested', 'approved', 'rejected', 'paid', 'billed'].includes(status)) {
    conditions.push(`status = $${i++}`); params.push(status);
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    conditions.push(`(
      "vendorName"             ILIKE $${i} OR
      COALESCE("billNo",'')    ILIKE $${i} OR
      COALESCE("purpose",'')   ILIKE $${i} OR
      COALESCE("requestedByName",'') ILIKE $${i}
    )`);
    params.push(`%${q}%`); i++;
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const rows = await query<any>(
      `SELECT vp.*,
              (SELECT COUNT(*)::int FROM "PortalFile" pf
                 WHERE pf."entityType" = 'vendor-payment' AND pf."entityId" = vp.id) AS "fileCount"
         FROM "VendorPayment" vp ${whereSql}
         ORDER BY (vp."status"='requested') DESC, vp."dueDate" ASC NULLS LAST, vp."createdAt" DESC LIMIT 1000`,
      params
    );
    // Headline counts for the approver: how many waiting + total to pay.
    const summary = await queryOne<any>(`
      SELECT
        COUNT(*) FILTER (WHERE status='requested')::int AS pending,
        COALESCE(SUM(amount) FILTER (WHERE status='requested'),0) AS pending_amount,
        COALESCE(SUM(amount) FILTER (WHERE status='approved'),0)  AS approved_amount
      FROM "VendorPayment"
    `);
    return res.json({ ok: true, data: { payments: rows, summary } });
  } catch (err: any) {
    console.error('[api/vendor-payments] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Vendor payments query failed' });
  }
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireViewEdit(user, res, 'vendor-pay')) return;

  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const billDate = b.billDate ? new Date(b.billDate) : null;
  if (billDate && isNaN(billDate.getTime())) return res.status(400).json({ ok: false, error: 'Invalid bill date' });
  const dueDate = b.dueDate ? new Date(b.dueDate) : null;
  if (dueDate && isNaN(dueDate.getTime())) return res.status(400).json({ ok: false, error: 'Invalid due date' });

  const id = newId('vpay');
  try {
    await query(
      `INSERT INTO "VendorPayment"
        (id, "vendorName", "billNo", amount, purpose, "billDate", "dueDate", department,
         status, "requestedByExecId", "requestedByName", notes, "createdBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'requested',$9,$10,$11,$12,NOW(),NOW())`,
      [
        id, b.vendorName, b.billNo || null, b.amount, b.purpose || null,
        billDate ? billDate.toISOString() : null, dueDate ? dueDate.toISOString() : null,
        b.department || user.role || null, user.execId, user.name, b.notes || null, user.execId,
      ]
    );
    audit(req, user, 'VENDOR_PAYMENT_REQUEST', b.vendorName, { id, amount: b.amount, billNo: b.billNo });
    const row = await queryOne<any>(`SELECT * FROM "VendorPayment" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { payment: row } });
  } catch (err: any) {
    console.error('[api/vendor-payments] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Create vendor payment failed' });
  }
}
