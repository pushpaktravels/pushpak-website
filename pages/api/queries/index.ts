// ============================================================
// /api/queries — query submissions: list + create (fill).
// ============================================================
//   GET  ?status=&formKey=&q=  → the response list (accounts desk, 'queries').
//   GET  ?scope=mine           → the caller's own submissions ('query-fill').
//   POST                       → file a query against a form ('query-fill').
//
// Filling is broad (any role allowed by the form); reading the response list
// is the accounts desk. Attachments are uploaded separately to /api/files
// with entityType='query'. Portal-only; pushing later is DRY-RUN.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const CreateBody = z.object({
  formKey: z.string().min(1).max(40),
  values: z.record(z.any()).default({}),
  department: z.string().max(60).optional().nullable(),
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
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (scope === 'mine') {
    // A submitter reviewing what they filed — only their own rows.
    if (!requireView(user, res, 'query-fill')) return;
    conditions.push(`"submittedByExecId" = $${i++}`); params.push(user.execId);
  } else {
    // The accounts response list.
    if (!requireView(user, res, 'queries')) return;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && ['open', 'accepted', 'rejected'].includes(status)) { conditions.push(`status = $${i++}`); params.push(status); }

  const formKey = typeof req.query.formKey === 'string' ? req.query.formKey : '';
  if (formKey) { conditions.push(`"formKey" = $${i++}`); params.push(formKey); }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    conditions.push(`(
      "formTitle"        ILIKE $${i} OR
      COALESCE("submittedByName",'') ILIKE $${i} OR
      COALESCE("relatedParty",'')    ILIKE $${i} OR
      values::text       ILIKE $${i}
    )`);
    params.push(`%${q}%`); i++;
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const rows = await query<any>(
      `SELECT qy.*,
              (SELECT COUNT(*)::int FROM "PortalFile" pf
                 WHERE pf."entityType" = 'query' AND pf."entityId" = qy.id) AS "fileCount"
         FROM "Query" qy ${whereSql}
         ORDER BY (qy.status='open') DESC, qy."createdAt" DESC LIMIT 1000`,
      params,
    );
    const summary = await queryOne<any>(`
      SELECT COUNT(*) FILTER (WHERE status='open')::int AS open,
             COUNT(*) FILTER (WHERE status='accepted')::int AS accepted,
             COUNT(*) FILTER (WHERE status='rejected')::int AS rejected
      FROM "Query"
    `);
    return res.json({ ok: true, data: { queries: rows, summary } });
  } catch (err: any) {
    console.error('[api/queries] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Query list failed' });
  }
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireViewEdit(user, res, 'query-fill')) return;

  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const form = await queryOne<any>(`SELECT * FROM "QueryForm" WHERE key = $1`, [b.formKey]);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });
  if (!form.active) return res.status(400).json({ ok: false, error: 'This form is not active' });
  // Enforce the form's fill permission server-side (UI only hides it).
  const fillRoles: string[] = form.fillRoles || [];
  if (user.role !== 'owner' && fillRoles.length > 0 && !fillRoles.includes(user.role)) {
    return res.status(403).json({ ok: false, error: 'You cannot fill this form' });
  }

  const id = newId('query');
  try {
    await query(
      `INSERT INTO "Query"
         (id, "formKey", "formTitle", values, status, "submittedByExecId", "submittedByName", department, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4::jsonb,'open',$5,$6,$7,NOW(),NOW())`,
      [id, form.key, form.title, JSON.stringify(b.values || {}), user.execId, user.name, b.department || user.role || null],
    );
    audit(req, user, 'QUERY_SUBMIT', form.key, { id });
    const row = await queryOne<any>(`SELECT * FROM "Query" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { query: row } });
  } catch (err: any) {
    console.error('[api/queries] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Submit failed' });
  }
}
