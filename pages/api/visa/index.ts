// ============================================================
// /api/visa — Visa desk application list + create.
// ============================================================
// GET  ?scope=all|mine|upcoming & q=<search> & stage=<stage>
//   • all      → every application
//   • mine     → the caller's own cases (drives "My Worklist")
//   • upcoming → has an appointment in the future, soonest first
// POST → log a new application.
//
// Gated on the 'visa' view. Creating an application with an appointment
// date drops a reminder Task into the owning agent's inbox via lib/visa.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { syncAppointmentTask, VISA_STAGES } from '@/lib/visa';

const VISA_TYPES = ['tourist', 'business', 'student', 'work', 'transit', 'medical', 'other'] as const;

const CreateBody = z.object({
  applicantName:   z.string().min(1).max(200),
  passportNo:      z.string().max(40).optional().nullable(),
  contact:         z.string().max(100).optional().nullable(),
  email:           z.string().max(160).optional().nullable(),
  nationality:     z.string().max(60).optional().nullable(),
  country:         z.string().min(1).max(80),
  visaType:        z.enum(VISA_TYPES).default('tourist'),
  stage:           z.enum(VISA_STAGES).default('enquiry'),
  priority:        z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  appointmentAt:   z.string().optional().nullable(),
  fee:             z.coerce.number().min(0).max(1e9).default(0),
  amountCollected: z.coerce.number().min(0).max(1e9).default(0),
  vendor:          z.string().max(120).optional().nullable(),
  refNo:           z.string().max(80).optional().nullable(),
  assigneeExecId:  z.string().max(60).optional().nullable(),
  assigneeName:    z.string().max(120).optional().nullable(),
  leadId:          z.string().max(60).optional().nullable(),
  notes:           z.string().max(4000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'visa')) return;

  if (req.method === 'GET') return list(req, res, user);
  if (req.method === 'POST') return create(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse, user: any) {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
  const where: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (scope === 'mine') { where.push(`"assigneeExecId" = $${i++}`); params.push(user.execId); }
  else if (scope === 'upcoming') {
    where.push(`"appointmentAt" IS NOT NULL AND "appointmentAt" >= NOW()`);
    where.push(`stage NOT IN ('approved','rejected','delivered')`);
  }

  const stage = typeof req.query.stage === 'string' ? req.query.stage : '';
  if (stage && (VISA_STAGES as readonly string[]).includes(stage)) {
    where.push(`stage = $${i++}`); params.push(stage);
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    where.push(`(
      "applicantName" ILIKE $${i} OR
      COALESCE("passportNo",'') ILIKE $${i} OR
      COALESCE("country",'')    ILIKE $${i} OR
      COALESCE("contact",'')    ILIKE $${i} OR
      COALESCE("refNo",'')      ILIKE $${i} OR
      COALESCE("assigneeName",'') ILIKE $${i}
    )`);
    params.push(`%${q}%`); i++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Upcoming = soonest appointment first; otherwise newest first.
  const orderSql = scope === 'upcoming'
    ? `ORDER BY "appointmentAt" ASC`
    : `ORDER BY "createdAt" DESC`;

  try {
    const rows = await query<any>(`SELECT * FROM "VisaApplication" ${whereSql} ${orderSql} LIMIT 1000`, params);
    return res.json({ ok: true, data: { applications: rows } });
  } catch (err: any) {
    console.error('[api/visa] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Visa query failed' });
  }
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireViewEdit(user, res, 'visa')) return;

  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  if (b.amountCollected > b.fee) {
    return res.status(400).json({ ok: false, error: 'Collected amount cannot exceed the fee' });
  }
  const appt = b.appointmentAt ? new Date(b.appointmentAt) : null;
  if (appt && isNaN(appt.getTime())) {
    return res.status(400).json({ ok: false, error: 'Invalid appointment date' });
  }

  // Default the owning agent to the creator unless one was supplied.
  const assigneeExecId = b.assigneeExecId ?? user.execId;
  const assigneeName = b.assigneeName ?? user.name;
  const id = newId('visa');

  try {
    await query(
      `INSERT INTO "VisaApplication"
        (id, "applicantName", "passportNo", contact, email, nationality, country,
         "visaType", stage, priority, "appointmentAt", fee, "amountCollected",
         vendor, "refNo", "assigneeExecId", "assigneeName", "leadId", notes,
         "createdBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW())`,
      [
        id, b.applicantName, b.passportNo || null, b.contact || null, b.email || null,
        b.nationality || 'Indian', b.country, b.visaType, b.stage, b.priority,
        appt ? appt.toISOString() : null, b.fee, b.amountCollected,
        b.vendor || null, b.refNo || null, assigneeExecId, assigneeName,
        b.leadId || null, b.notes || null, user.execId,
      ]
    );

    // Surface the appointment as a reminder Task for the owning agent.
    await syncAppointmentTask({
      id, applicantName: b.applicantName, country: b.country, stage: b.stage,
      appointmentAt: appt, assigneeExecId, assigneeName,
    });

    audit(req, user, 'VISA_CREATE', b.applicantName, { id, country: b.country, stage: b.stage });

    const row = await queryOne<any>(`SELECT * FROM "VisaApplication" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { application: row } });
  } catch (err: any) {
    console.error('[api/visa] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Create visa application failed' });
  }
}
