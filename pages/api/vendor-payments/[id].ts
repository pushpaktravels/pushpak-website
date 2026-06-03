// ============================================================
// /api/vendor-payments/[id] — review / pay / bill / edit / delete.
// ============================================================
// PATCH { action } drives the approval flow, with the state machine enforced
// server-side so no step can be skipped (no paying an unapproved bill):
//   approve  requested → approved          (manager only)
//   reject   requested → rejected (+note)  (manager only)
//   pay      approved  → paid    (+mode/ref)(manager only)
//   bill     paid      → billed            (any editor)
//   edit     (only while 'requested')      (requester or manager)
// DELETE → owner/admin only.
//
// Portal-only; never touches FinBook. View-edit on 'vendor-pay'.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { PAYMENT_MODES, VENDOR_APPROVER_ROLES } from '@/lib/vendorpay';

const PatchBody = z.object({
  action:      z.enum(['approve', 'reject', 'pay', 'bill', 'edit']),
  reviewNote:  z.string().max(1000).optional().nullable(),
  paymentMode: z.enum(PAYMENT_MODES as unknown as [string, ...string[]]).optional(),
  paymentRef:  z.string().max(120).optional().nullable(),
  // editable fields (action='edit', only while still 'requested')
  vendorName:  z.string().min(1).max(200).optional(),
  billNo:      z.string().max(60).optional().nullable(),
  amount:      z.coerce.number().min(0).max(1e9).optional(),
  purpose:     z.string().max(500).optional().nullable(),
  billDate:    z.string().optional().nullable(),
  dueDate:     z.string().optional().nullable(),
  notes:       z.string().max(2000).optional().nullable(),
});

const EDIT_COLUMN: Record<string, string> = {
  vendorName: '"vendorName"', billNo: '"billNo"', amount: 'amount', purpose: 'purpose',
  billDate: '"billDate"', dueDate: '"dueDate"', notes: 'notes',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!requireView(user, res, 'vendor-pay')) return;
  if (!requireViewEdit(user, res, 'vendor-pay')) return;

  const existing = await queryOne<any>(`SELECT * FROM "VendorPayment" WHERE id = $1 LIMIT 1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Vendor payment not found' });

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete a vendor payment' });
    }
    try {
      await query(`DELETE FROM "VendorPayment" WHERE id = $1`, [id]);
      audit(req, user, 'VENDOR_PAYMENT_DELETE', existing.vendorName, { id, amount: existing.amount });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[api/vendor-payments/[id]] delete error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Delete failed' });
    }
  }

  // PATCH
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;
  const isApprover = VENDOR_APPROVER_ROLES.has(user.role);
  const st = existing.status as string;

  try {
    if (b.action === 'approve') {
      if (!isApprover) return res.status(403).json({ ok: false, error: 'Only a manager can approve payments' });
      if (st !== 'requested') return res.status(409).json({ ok: false, error: `Cannot approve a ${st} request` });
      await query(
        `UPDATE "VendorPayment" SET status='approved', "reviewedByExecId"=$2, "reviewedByName"=$3,
           "reviewedAt"=NOW(), "reviewNote"=$4, "updatedAt"=NOW() WHERE id=$1`,
        [id, user.execId, user.name, b.reviewNote || null]
      );
      audit(req, user, 'VENDOR_PAYMENT_APPROVE', existing.vendorName, { id, amount: existing.amount });

    } else if (b.action === 'reject') {
      if (!isApprover) return res.status(403).json({ ok: false, error: 'Only a manager can reject payments' });
      if (st !== 'requested') return res.status(409).json({ ok: false, error: `Cannot reject a ${st} request` });
      await query(
        `UPDATE "VendorPayment" SET status='rejected', "reviewedByExecId"=$2, "reviewedByName"=$3,
           "reviewedAt"=NOW(), "reviewNote"=$4, "updatedAt"=NOW() WHERE id=$1`,
        [id, user.execId, user.name, b.reviewNote || null]
      );
      audit(req, user, 'VENDOR_PAYMENT_REJECT', existing.vendorName, { id, note: b.reviewNote });

    } else if (b.action === 'pay') {
      if (!isApprover) return res.status(403).json({ ok: false, error: 'Only a manager can record a payment' });
      if (st !== 'approved') return res.status(409).json({ ok: false, error: `Only an approved request can be paid (this is ${st})` });
      if (!b.paymentMode) return res.status(400).json({ ok: false, error: 'Choose how the payment was made' });
      await query(
        `UPDATE "VendorPayment" SET status='paid', "paymentMode"=$2, "paymentRef"=$3,
           "paidByExecId"=$4, "paidByName"=$5, "paidAt"=NOW(), "updatedAt"=NOW() WHERE id=$1`,
        [id, b.paymentMode, b.paymentRef || null, user.execId, user.name]
      );
      audit(req, user, 'VENDOR_PAYMENT_PAID', existing.vendorName, { id, amount: existing.amount, mode: b.paymentMode });

    } else if (b.action === 'bill') {
      if (st !== 'paid') return res.status(409).json({ ok: false, error: `Only a paid request can be billed (this is ${st})` });
      await query(
        `UPDATE "VendorPayment" SET status='billed', "billedByExecId"=$2, "billedByName"=$3,
           "billedAt"=NOW(), "updatedAt"=NOW() WHERE id=$1`,
        [id, user.execId, user.name]
      );
      audit(req, user, 'VENDOR_PAYMENT_BILLED', existing.vendorName, { id });

    } else { // edit
      if (st !== 'requested') return res.status(409).json({ ok: false, error: 'Only a request still awaiting approval can be edited' });
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      for (const [key, col] of Object.entries(EDIT_COLUMN)) {
        if (!(key in b)) continue;
        let val: any = (b as any)[key];
        if (key === 'billDate' || key === 'dueDate') {
          if (val) { const d = new Date(val); if (isNaN(d.getTime())) return res.status(400).json({ ok: false, error: `Invalid ${key}` }); val = d.toISOString(); }
          else val = null;
        }
        if (key === 'billNo' || key === 'purpose' || key === 'notes') val = val || null;
        sets.push(`${col} = $${i++}`);
        params.push(val);
      }
      if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Nothing to update' });
      sets.push(`"updatedAt" = NOW()`);
      params.push(id);
      await query(`UPDATE "VendorPayment" SET ${sets.join(', ')} WHERE id = $${i}`, params);
      audit(req, user, 'VENDOR_PAYMENT_UPDATE', existing.vendorName, { id, changed: Object.keys(b).filter(k => k !== 'action') });
    }

    const row = await queryOne<any>(`SELECT * FROM "VendorPayment" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { payment: row } });
  } catch (err: any) {
    console.error('[api/vendor-payments/[id]] patch error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Update failed' });
  }
}
