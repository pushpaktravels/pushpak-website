// ============================================================
// /api/visa/[id] — update / advance / delete a visa application.
// ============================================================
// PATCH body: any of the editable fields (stage, appointmentAt, fee,
//   amountCollected, assignee, …). Moving to a terminal stage stamps
//   decisionAt; any change re-syncs the appointment reminder Task.
// DELETE — owner/admin only; also cancels the linked Task.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { syncAppointmentTask, VISA_STAGES, VISA_TERMINAL_STAGES } from '@/lib/visa';
import { cancelOpenTasksFor } from '@/lib/tasks';

const VISA_TYPES = ['tourist', 'business', 'student', 'work', 'transit', 'medical', 'other'] as const;

const PatchBody = z.object({
  applicantName:   z.string().min(1).max(200).optional(),
  passportNo:      z.string().max(40).optional().nullable(),
  contact:         z.string().max(100).optional().nullable(),
  email:           z.string().max(160).optional().nullable(),
  nationality:     z.string().max(60).optional().nullable(),
  country:         z.string().min(1).max(80).optional(),
  visaType:        z.enum(VISA_TYPES).optional(),
  stage:           z.enum(VISA_STAGES).optional(),
  priority:        z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  appointmentAt:   z.string().optional().nullable(),
  submittedAt:     z.string().optional().nullable(),
  fee:             z.coerce.number().min(0).max(1e9).optional(),
  amountCollected: z.coerce.number().min(0).max(1e9).optional(),
  vendor:          z.string().max(120).optional().nullable(),
  refNo:           z.string().max(80).optional().nullable(),
  assigneeExecId:  z.string().max(60).optional().nullable(),
  assigneeName:    z.string().max(120).optional().nullable(),
  notes:           z.string().max(4000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'visa')) return;

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const existing = await queryOne<any>(`SELECT * FROM "VisaApplication" WHERE id = $1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Application not found' });

  if (req.method === 'PATCH') {
    if (!requireViewEdit(user, res, 'visa')) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
    const b = parsed.data;

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const put = (col: string, val: any) => { sets.push(`"${col}" = $${i++}`); params.push(val); };

    if (b.applicantName !== undefined) put('applicantName', b.applicantName);
    if (b.passportNo !== undefined) put('passportNo', b.passportNo);
    if (b.contact !== undefined) put('contact', b.contact);
    if (b.email !== undefined) put('email', b.email);
    if (b.nationality !== undefined) put('nationality', b.nationality);
    if (b.country !== undefined) put('country', b.country);
    if (b.visaType !== undefined) put('visaType', b.visaType);
    if (b.stage !== undefined) put('stage', b.stage);
    if (b.priority !== undefined) put('priority', b.priority);
    if (b.appointmentAt !== undefined) put('appointmentAt', b.appointmentAt ? new Date(b.appointmentAt).toISOString() : null);
    if (b.submittedAt !== undefined) put('submittedAt', b.submittedAt ? new Date(b.submittedAt).toISOString() : null);
    if (b.fee !== undefined) put('fee', b.fee);
    if (b.amountCollected !== undefined) put('amountCollected', b.amountCollected);
    if (b.vendor !== undefined) put('vendor', b.vendor);
    if (b.refNo !== undefined) put('refNo', b.refNo);
    if (b.assigneeExecId !== undefined) put('assigneeExecId', b.assigneeExecId);
    if (b.assigneeName !== undefined) put('assigneeName', b.assigneeName);
    if (b.notes !== undefined) put('notes', b.notes);

    // Stamp a decision date the first time the case reaches a terminal stage.
    if (b.stage !== undefined && VISA_TERMINAL_STAGES.has(b.stage) && !existing.decisionAt) {
      put('decisionAt', new Date().toISOString());
    }

    if (sets.length === 0) return res.json({ ok: true });
    sets.push(`"updatedAt" = NOW()`);
    params.push(id);
    await query(`UPDATE "VisaApplication" SET ${sets.join(', ')} WHERE id = $${i}`, params);

    // Re-sync the appointment reminder against the new state.
    const updated = await queryOne<any>(`SELECT * FROM "VisaApplication" WHERE id = $1`, [id]);
    await syncAppointmentTask({
      id,
      applicantName: updated.applicantName,
      country: updated.country,
      stage: updated.stage,
      appointmentAt: updated.appointmentAt,
      assigneeExecId: updated.assigneeExecId,
      assigneeName: updated.assigneeName,
    });

    audit(req, user, 'VISA_UPDATE', id, { fields: Object.keys(b), stage: b.stage });
    return res.json({ ok: true, data: { application: updated } });
  }

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete applications' });
    }
    await query(`DELETE FROM "VisaApplication" WHERE id = $1`, [id]);
    await cancelOpenTasksFor('visa', id);
    audit(req, user, 'VISA_DELETE', id, { applicant: existing.applicantName });
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
