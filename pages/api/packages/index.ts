// ============================================================
// /api/packages — Package desks (domestic + international) list + create.
// ============================================================
// Shared by both package departments; the `department` discriminator
// keeps each desk's list separate. The matching VIEW key IS the
// department slug ('domestic-package' | 'international-packages'), so a
// desk user only ever sees and gates on their own department; owner/admin
// can read either via the ?department query param.
//
// GET  ?department=<slug> & scope=all|mine|upcoming & q= & stage=
// POST → create a package (department taken from body, pinned to the
//        caller's own department for non-managers).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { syncPackageTasks, PACKAGE_DEPARTMENTS, PACKAGE_STAGES } from '@/lib/packages';

const isManager = (u: any) => u.role === 'owner' || u.role === 'admin';

// Resolve which department (and therefore which view to gate on) this
// request is for. Non-managers are pinned to their own department.
function resolveDept(user: any, raw: unknown): string | null {
  const reqDept = typeof raw === 'string' ? raw : '';
  if (!isManager(user)) {
    return (PACKAGE_DEPARTMENTS as readonly string[]).includes(user.role) ? user.role : null;
  }
  return (PACKAGE_DEPARTMENTS as readonly string[]).includes(reqDept) ? reqDept : null;
}

const CreateBody = z.object({
  title:           z.string().min(1).max(200),
  department:      z.enum(PACKAGE_DEPARTMENTS),
  customerName:    z.string().min(1).max(200),
  contact:         z.string().max(100).optional().nullable(),
  email:           z.string().max(160).optional().nullable(),
  destination:     z.string().max(160).optional().nullable(),
  paxCount:        z.coerce.number().int().min(1).max(200).default(1),
  travelStart:     z.string().optional().nullable(),
  travelEnd:       z.string().optional().nullable(),
  stage:           z.enum(PACKAGE_STAGES).default('enquiry'),
  priority:        z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  packageCost:     z.coerce.number().min(0).max(1e9).default(0),
  amountCollected: z.coerce.number().min(0).max(1e9).default(0),
  vendor:          z.string().max(160).optional().nullable(),
  refNo:           z.string().max(80).optional().nullable(),
  assigneeExecId:  z.string().max(60).optional().nullable(),
  assigneeName:    z.string().max(120).optional().nullable(),
  leadId:          z.string().max(60).optional().nullable(),
  notes:           z.string().max(4000).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method === 'GET') return list(req, res, user);
  if (req.method === 'POST') return create(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse, user: any) {
  const dept = resolveDept(user, req.query.department);
  if (!dept) return res.status(400).json({ ok: false, error: 'Unknown package department' });
  if (!requireView(user, res, dept)) return;

  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
  const where: string[] = [`department = $1`];
  const params: any[] = [dept];
  let i = 2;

  if (scope === 'mine') { where.push(`"assigneeExecId" = $${i++}`); params.push(user.execId); }
  else if (scope === 'upcoming') {
    where.push(`"travelStart" IS NOT NULL AND "travelStart" >= NOW()`);
    where.push(`stage NOT IN ('completed','cancelled')`);
  }

  const stage = typeof req.query.stage === 'string' ? req.query.stage : '';
  if (stage && (PACKAGE_STAGES as readonly string[]).includes(stage)) {
    where.push(`stage = $${i++}`); params.push(stage);
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    where.push(`(
      title ILIKE $${i} OR
      "customerName" ILIKE $${i} OR
      COALESCE(destination,'') ILIKE $${i} OR
      COALESCE(contact,'')     ILIKE $${i} OR
      COALESCE("refNo",'')     ILIKE $${i} OR
      COALESCE("assigneeName",'') ILIKE $${i}
    )`);
    params.push(`%${q}%`); i++;
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = scope === 'upcoming' ? `ORDER BY "travelStart" ASC` : `ORDER BY "createdAt" DESC`;

  try {
    const rows = await query<any>(`SELECT * FROM "Package" ${whereSql} ${orderSql} LIMIT 1000`, params);
    return res.json({ ok: true, data: { packages: rows } });
  } catch (err: any) {
    console.error('[api/packages] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Packages query failed' });
  }
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  // Non-managers may only create in their own department.
  if (!isManager(user) && user.role !== b.department) {
    return res.status(403).json({ ok: false, error: 'Cannot create in another department' });
  }
  if (!requireView(user, res, b.department)) return;
  if (!requireViewEdit(user, res, b.department)) return;

  if (b.amountCollected > b.packageCost) {
    return res.status(400).json({ ok: false, error: 'Collected amount cannot exceed the package cost' });
  }
  const start = b.travelStart ? new Date(b.travelStart) : null;
  const end = b.travelEnd ? new Date(b.travelEnd) : null;
  if (start && isNaN(start.getTime())) return res.status(400).json({ ok: false, error: 'Invalid travel start date' });
  if (end && isNaN(end.getTime())) return res.status(400).json({ ok: false, error: 'Invalid travel end date' });

  const assigneeExecId = b.assigneeExecId ?? user.execId;
  const assigneeName = b.assigneeName ?? user.name;
  const id = newId('pkg');

  try {
    await query(
      `INSERT INTO "Package"
        (id, title, department, "customerName", contact, email, destination,
         "paxCount", "travelStart", "travelEnd", stage, priority,
         "packageCost", "amountCollected", vendor, "refNo",
         "assigneeExecId", "assigneeName", "leadId", notes, "createdBy",
         "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())`,
      [
        id, b.title, b.department, b.customerName, b.contact || null, b.email || null,
        b.destination || null, b.paxCount, start ? start.toISOString() : null,
        end ? end.toISOString() : null, b.stage, b.priority, b.packageCost, b.amountCollected,
        b.vendor || null, b.refNo || null, assigneeExecId, assigneeName, b.leadId || null,
        b.notes || null, user.execId,
      ]
    );

    await syncPackageTasks({
      id, title: b.title, department: b.department, stage: b.stage,
      travelStart: start, assigneeExecId, assigneeName,
    });

    audit(req, user, 'PACKAGE_CREATE', b.title, { id, department: b.department, stage: b.stage });

    const row = await queryOne<any>(`SELECT * FROM "Package" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { package: row } });
  } catch (err: any) {
    console.error('[api/packages] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Create package failed' });
  }
}
