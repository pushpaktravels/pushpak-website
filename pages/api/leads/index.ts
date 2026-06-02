// ============================================================
// /api/leads — cross-department sales pipeline.
// ============================================================
// GET  ?scope=mine|department|all & stage= & source= & department= & q=
// POST → capture a new lead.
//
// Gated on the 'leads' view (Marketing + the booking/package/visa desks).
// Owner/admin see everything; a desk sees leads routed to its department
// or assigned to the caller.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const SOURCES = ['website', 'whatsapp', 'call', 'walkin', 'referral', 'instagram', 'other'] as const;
const DEPTS = ['domestic-reservations', 'domestic-package', 'international-packages', 'visa'] as const;

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  contact: z.string().max(60).optional().nullable(),
  email: z.string().max(160).optional().nullable(),
  source: z.enum(SOURCES).default('other'),
  department: z.enum(DEPTS).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  assigneeExecId: z.string().max(60).optional().nullable(),
  assigneeName: z.string().max(120).optional().nullable(),
  estValue: z.coerce.number().min(0).max(1e9).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'leads')) return;

  if (req.method === 'GET') {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    const isManager = user.role === 'owner' || user.role === 'admin' || user.role === 'marketing';
    if (scope === 'mine') { where.push(`"assigneeExecId" = $${i++}`); params.push(user.execId); }
    else if (scope === 'department' || !isManager) { where.push(`department = $${i++}`); params.push(user.role); }
    // managers + scope 'all' → no scoping

    if (typeof req.query.stage === 'string') { where.push(`stage = $${i++}`); params.push(req.query.stage); }
    if (typeof req.query.source === 'string') { where.push(`source = $${i++}`); params.push(req.query.source); }
    if (typeof req.query.department === 'string') { where.push(`department = $${i++}`); params.push(req.query.department); }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      where.push(`(name ILIKE $${i} OR contact ILIKE $${i} OR email ILIKE $${i})`);
      params.push(`%${req.query.q.trim()}%`); i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const leads = await query(
      `SELECT * FROM "Lead" ${whereSql} ORDER BY "createdAt" DESC LIMIT 1000`,
      params
    );
    return res.json({ ok: true, leads });
  }

  if (req.method === 'POST') {
    if (!requireViewEdit(user, res, 'leads')) return;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
    const b = parsed.data;
    const id = newId('lead');
    const rows = await query(
      `INSERT INTO "Lead"
         (id, name, contact, email, source, department, stage, priority,
          "assigneeExecId", "assigneeName", "estValue", notes, "createdBy",
          "lastActivityAt", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'new',$7,$8,$9,$10,$11,$12, NOW(), NOW(), NOW())
       RETURNING *`,
      [id, b.name, b.contact ?? null, b.email ?? null, b.source, b.department ?? null,
       b.priority, b.assigneeExecId ?? null, b.assigneeName ?? null,
       b.estValue ?? null, b.notes ?? null, user.execId]
    );
    audit(req, user, 'LEAD_CREATE', id, { name: b.name, source: b.source, department: b.department });
    return res.json({ ok: true, lead: rows[0] });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
