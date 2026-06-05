// ============================================================
// /api/billing — Phase 3 auto-billing (dry-run spine): list + generate.
// ============================================================
// GET  → the bill outbox (PortalBill rows) + the bookings that are READY to
//        bill (Ticketed, not yet billed) + headline counts + the live
//        FinBook mode, so the console can badge "Simulated" vs "Live".
// POST → generate a bill for ONE booking: build the /salesdetails payload,
//        send it through the FinBook chokepoint (dry-run by default), and
//        record the attempt in PortalBill. Idempotent on refKey — a booking
//        maps to exactly one bill; re-posting a booking with an already-LIVE
//        bill is refused (409) so we never double-bill for real.
//
// Gated on the 'billing' view; generating needs view-edit. SERVER-ONLY
// FinBook client is used here — the api key never reaches the browser.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { addSalesDetail, finbookMode, finbookBranchId } from '@/lib/finbook';
import { reservationToSalesDetail, reservationBillLabel, billRefKey } from '@/lib/billing';

const GenerateBody = z.object({
  reservationId: z.string().min(1),
  clientId:      z.string().min(1).max(40),     // FinBook ledger id to bill
  clientWebId:   z.string().max(40).optional().nullable(),
  clientLabel:   z.string().max(200).optional().nullable(),
  payType:       z.string().max(40).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'billing')) return;

  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return generate(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse) {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (status && ['simulated', 'posted', 'failed', 'void'].includes(status)) {
    conditions.push(`status = $${i++}`); params.push(status);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const bills = await query<any>(`SELECT * FROM "PortalBill" ${whereSql} ORDER BY "createdAt" DESC LIMIT 500`, params);

    // Bookings ready to bill: Ticketed and without a live/simulated bill yet.
    const billable = await query<any>(
      `SELECT * FROM "Reservation" r
        WHERE r.status = 'Ticketed'
          AND NOT EXISTS (
            SELECT 1 FROM "PortalBill" b WHERE b."sourceId" = r.id AND b.status <> 'void'
          )
        ORDER BY r."createdAt" DESC
        LIMIT 200`
    );

    const summary = await queryOne<any>(`
      SELECT
        COUNT(*) FILTER (WHERE status='simulated')::int AS simulated,
        COUNT(*) FILTER (WHERE status='posted')::int    AS posted,
        COUNT(*) FILTER (WHERE status='failed')::int    AS failed,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('simulated','posted')),0) AS billed_amount
      FROM "PortalBill"
    `);

    return res.json({ ok: true, mode: finbookMode(), data: { bills, billable, summary } });
  } catch (err: any) {
    console.error('[api/billing] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Billing query failed' });
  }
}

async function generate(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireViewEdit(user, res, 'billing')) return;

  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const rsv = await queryOne<any>(`SELECT * FROM "Reservation" WHERE id = $1 LIMIT 1`, [b.reservationId]);
  if (!rsv) return res.status(404).json({ ok: false, error: 'Reservation not found' });
  if (rsv.status === 'Cancelled') return res.status(409).json({ ok: false, error: 'Cannot bill a cancelled booking' });

  const refKey = billRefKey(rsv.id);

  // Idempotency guard: never overwrite a bill that has REALLY posted to
  // FinBook. A simulated/failed/void row may be regenerated.
  const existing = await queryOne<any>(`SELECT * FROM "PortalBill" WHERE "refKey" = $1 LIMIT 1`, [refKey]);
  if (existing && existing.status === 'posted') {
    return res.status(409).json({ ok: false, error: `This booking is already billed (doc ${existing.docNo || '—'}). Void it before re-billing.` });
  }

  const label = b.clientLabel || reservationBillLabel(rsv);
  const payload = reservationToSalesDetail(rsv, {
    branchId: finbookBranchId(),
    clientId: b.clientId,
    clientWebId: b.clientWebId || undefined,
    payType: b.payType || undefined,
  });

  // The one FinBook write — dry-run by default returns a simulated doc no.
  const result = await addSalesDetail(payload);
  const mode = finbookMode();
  const status = result.ok ? (result.simulated ? 'simulated' : 'posted') : 'failed';
  const docNo = result.ok ? result.data.docNo : null;
  const response = result.ok ? result.data : { error: result.error, httpStatus: (result as any).status };
  const errMsg = result.ok ? null : result.error;
  const amount = Number(rsv.fareAmount) || 0;

  const id = existing?.id || newId('pbill');
  try {
    await query(
      `INSERT INTO "PortalBill"
         (id, source, "sourceId", "refKey", "clientId", "clientWebId", "clientLabel", "serviceCode",
          amount, "docPrefix", "docNo", status, mode, simulated, payload, response, error,
          "generatedByExecId", "generatedByName", "postedAt", "createdAt", "updatedAt")
       VALUES ($1,'reservation',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,
               ${status === 'posted' ? 'NOW()' : 'NULL'}, NOW(), NOW())
       ON CONFLICT ("refKey") DO UPDATE SET
         "clientId"=EXCLUDED."clientId", "clientWebId"=EXCLUDED."clientWebId", "clientLabel"=EXCLUDED."clientLabel",
         amount=EXCLUDED.amount, "docNo"=EXCLUDED."docNo", status=EXCLUDED.status, mode=EXCLUDED.mode,
         simulated=EXCLUDED.simulated, payload=EXCLUDED.payload, response=EXCLUDED.response, error=EXCLUDED.error,
         "generatedByExecId"=EXCLUDED."generatedByExecId", "generatedByName"=EXCLUDED."generatedByName",
         "postedAt"=CASE WHEN EXCLUDED.status='posted' THEN NOW() ELSE "PortalBill"."postedAt" END,
         "updatedAt"=NOW()`,
      [
        id, rsv.id, refKey, b.clientId, b.clientWebId || null, label, payload.service_code,
        amount, payload.doc_prf, docNo, status, mode, result.ok ? result.simulated : (mode === 'dryrun'),
        JSON.stringify(payload), JSON.stringify(response), errMsg,
        user.execId, user.name,
      ]
    );
    audit(req, user, 'BILL_GENERATE', label, { reservationId: rsv.id, refKey, status, mode, docNo, amount });

    const row = await queryOne<any>(`SELECT * FROM "PortalBill" WHERE "refKey" = $1`, [refKey]);
    // Surface a clean failure to the UI but with 200 — the attempt was recorded.
    return res.json({ ok: true, mode, simulated: row.simulated, data: { bill: row, finbookOk: result.ok, finbookError: errMsg } });
  } catch (err: any) {
    console.error('[api/billing] generate error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Generate bill failed' });
  }
}
