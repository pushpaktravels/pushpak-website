// ============================================================
// /api/billing/[id] — void or delete a generated bill.
// ============================================================
// PATCH { action: 'void' } → mark the bill void (keeps the audit trail; the
//   booking becomes billable again so a corrected bill can be generated).
//   A LIVE-posted bill cannot simply be voided here — that needs a real
//   FinBook reversal (a later phase); we refuse so the books can't drift.
// DELETE → hard-remove the outbox row (owner/admin only). Use sparingly;
//   prefer void so the history survives.
//
// Re-generating a bill is just POST /api/billing again (idempotent on
// refKey), so there is no separate "retry" here.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const PatchBody = z.object({
  action: z.enum(['void']),
  note:   z.string().max(500).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'billing')) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const bill = await queryOne<any>(`SELECT * FROM "PortalBill" WHERE id = $1 LIMIT 1`, [id]);
  if (!bill) return res.status(404).json({ ok: false, error: 'Bill not found' });

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete a bill record' });
    }
    try {
      await query(`DELETE FROM "PortalBill" WHERE id = $1`, [id]);
      audit(req, user, 'BILL_DELETE', bill.clientLabel || bill.sourceId, { id, refKey: bill.refKey });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[api/billing/[id]] delete error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Delete failed' });
    }
  }

  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!requireViewEdit(user, res, 'billing')) return;

  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });

  // A genuinely posted (live) bill needs a FinBook-side reversal, not a
  // local flip — refuse here so the portal and the books can't disagree.
  if (bill.status === 'posted' && !bill.simulated) {
    return res.status(409).json({ ok: false, error: 'This bill is posted live in FinBook — it needs a FinBook reversal, not a local void.' });
  }

  try {
    await query(
      `UPDATE "PortalBill" SET status='void', "voidedByName"=$2, "voidedAt"=NOW(), error=$3, "updatedAt"=NOW() WHERE id=$1`,
      [id, user.name, parsed.data.note || null]
    );
    audit(req, user, 'BILL_VOID', bill.clientLabel || bill.sourceId, { id, refKey: bill.refKey });
    const row = await queryOne<any>(`SELECT * FROM "PortalBill" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { bill: row } });
  } catch (err: any) {
    console.error('[api/billing/[id]] void error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Void failed' });
  }
}
