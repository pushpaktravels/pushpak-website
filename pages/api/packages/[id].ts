// ============================================================
// /api/packages/[id] — update / advance / delete a package.
// ============================================================
// Gating uses the row's own department as the view key, so a desk user
// can only touch their own department's packages. PATCH re-syncs the
// voucher-prep reminder Task against the new state; DELETE (owner/admin)
// cancels it.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { syncPackageTasks, PACKAGE_STAGES } from '@/lib/packages';
import { cancelOpenTasksFor } from '@/lib/tasks';

const PatchBody = z.object({
  title:           z.string().min(1).max(200).optional(),
  customerName:    z.string().min(1).max(200).optional(),
  contact:         z.string().max(100).optional().nullable(),
  email:           z.string().max(160).optional().nullable(),
  destination:     z.string().max(160).optional().nullable(),
  paxCount:        z.coerce.number().int().min(1).max(200).optional(),
  travelStart:     z.string().optional().nullable(),
  travelEnd:       z.string().optional().nullable(),
  stage:           z.enum(PACKAGE_STAGES).optional(),
  priority:        z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  packageCost:     z.coerce.number().min(0).max(1e9).optional(),
  amountCollected: z.coerce.number().min(0).max(1e9).optional(),
  vendor:          z.string().max(160).optional().nullable(),
  refNo:           z.string().max(80).optional().nullable(),
  assigneeExecId:  z.string().max(60).optional().nullable(),
  assigneeName:    z.string().max(120).optional().nullable(),
  notes:           z.string().max(4000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const existing = await queryOne<any>(`SELECT * FROM "Package" WHERE id = $1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Package not found' });

  // Gate on the row's own department view.
  if (!requireView(user, res, existing.department)) return;

  if (req.method === 'PATCH') {
    if (!requireViewEdit(user, res, existing.department)) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
    const b = parsed.data;

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const put = (col: string, val: any) => { sets.push(`"${col}" = $${i++}`); params.push(val); };

    if (b.title !== undefined) put('title', b.title);
    if (b.customerName !== undefined) put('customerName', b.customerName);
    if (b.contact !== undefined) put('contact', b.contact);
    if (b.email !== undefined) put('email', b.email);
    if (b.destination !== undefined) put('destination', b.destination);
    if (b.paxCount !== undefined) put('paxCount', b.paxCount);
    if (b.travelStart !== undefined) put('travelStart', b.travelStart ? new Date(b.travelStart).toISOString() : null);
    if (b.travelEnd !== undefined) put('travelEnd', b.travelEnd ? new Date(b.travelEnd).toISOString() : null);
    if (b.stage !== undefined) put('stage', b.stage);
    if (b.priority !== undefined) put('priority', b.priority);
    if (b.packageCost !== undefined) put('packageCost', b.packageCost);
    if (b.amountCollected !== undefined) put('amountCollected', b.amountCollected);
    if (b.vendor !== undefined) put('vendor', b.vendor);
    if (b.refNo !== undefined) put('refNo', b.refNo);
    if (b.assigneeExecId !== undefined) put('assigneeExecId', b.assigneeExecId);
    if (b.assigneeName !== undefined) put('assigneeName', b.assigneeName);
    if (b.notes !== undefined) put('notes', b.notes);

    if (sets.length === 0) return res.json({ ok: true });
    sets.push(`"updatedAt" = NOW()`);
    params.push(id);
    await query(`UPDATE "Package" SET ${sets.join(', ')} WHERE id = $${i}`, params);

    const updated = await queryOne<any>(`SELECT * FROM "Package" WHERE id = $1`, [id]);
    await syncPackageTasks({
      id,
      title: updated.title,
      department: updated.department,
      stage: updated.stage,
      travelStart: updated.travelStart,
      assigneeExecId: updated.assigneeExecId,
      assigneeName: updated.assigneeName,
    });

    audit(req, user, 'PACKAGE_UPDATE', id, { fields: Object.keys(b), stage: b.stage });
    return res.json({ ok: true, data: { package: updated } });
  }

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete packages' });
    }
    await query(`DELETE FROM "Package" WHERE id = $1`, [id]);
    await cancelOpenTasksFor('package', id);
    audit(req, user, 'PACKAGE_DELETE', id, { title: existing.title });
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
