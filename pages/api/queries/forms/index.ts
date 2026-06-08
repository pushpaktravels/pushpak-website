// ============================================================
// /api/queries/forms — the query-form registry.
// ============================================================
//   GET ?mode=fill   → active forms the caller may FILL (role match), for
//                      the "Fill a Query" page. Default mode.
//   GET ?mode=manage → every form (owner only) for the registry editor.
//   POST             → create a form (owner only).
//
// Who-may-fill / who-may-view / fields are all owner-controlled here, which
// is the whole point of the module: the owner reshapes the forms without a
// code change. Portal-only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { formInDept } from '@/lib/queries';

const FieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'textarea', 'number', 'money', 'date', 'select', 'account', 'file']),
  required: z.boolean().optional(),
  options: z.array(z.string().max(80)).max(40).optional(),
  help: z.string().max(200).optional(),
});

const FormBody = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/, 'key must be lower-case slug'),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  fields: z.array(FieldSchema).max(40).default([]),
  fillRoles: z.array(z.string().max(40)).max(30).default([]),
  fillDepts: z.array(z.string().max(40)).max(30).default(['all']),
  viewRoles: z.array(z.string().max(40)).max(30).default(['owner', 'admin', 'cm-accounts', 'accounts']),
  defaultClassify: z.enum(['supplier', 'client', 'card', 'payment']).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method === 'GET') return listForms(req, res, user);
  if (req.method === 'POST') return createForm(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

// Can this user fill this form? Owner/admin always (they manage the
// registry). Otherwise BOTH gates must pass: the role gate (empty fillRoles =
// everyone, else the role must be listed) AND the department gate (fillDepts
// 'all', or the role's department is listed). This is what makes "not every
// form visible to all" real — a form pinned to e.g. ['accounts'] only shows
// to the accounts desk.
function canFill(user: any, form: { fillRoles?: string[]; fillDepts?: string[] }): boolean {
  if (user.role === 'owner' || user.role === 'admin') return true;
  const fillRoles = form.fillRoles || [];
  if (fillRoles.length > 0 && !fillRoles.includes(user.role)) return false;
  return formInDept(user.role, form.fillDepts);
}

async function listForms(req: NextApiRequest, res: NextApiResponse, user: any) {
  const mode = typeof req.query.mode === 'string' ? req.query.mode : 'fill';

  if (mode === 'manage') {
    // Registry editor — owner only (the gate that lets the owner reshape forms).
    if (!requireView(user, res, 'queries')) return;
    if (user.role !== 'owner') return res.status(403).json({ ok: false, error: 'Owner only' });
    const rows = await query<any>(`SELECT * FROM "QueryForm" ORDER BY "sortOrder", title`);
    return res.json({ ok: true, forms: rows });
  }

  if (mode === 'responses') {
    // The accounts Queries desk — the list of forms whose responses land here,
    // used to populate the "which form" filter dropdown. Excludes routed forms
    // (routeTo set): a Vendor Payments submission becomes a VendorPayment, not
    // a Query, so it has no response on this desk and must not appear in the
    // filter. Includes inactive forms so old responses still map to a name.
    if (!requireView(user, res, 'queries')) return;
    const rows = await query<any>(`SELECT * FROM "QueryForm" WHERE "routeTo" IS NULL ORDER BY "sortOrder", title`);
    return res.json({ ok: true, forms: rows });
  }

  // Fill mode: forms the caller may fill. Needs the broad 'query-fill' view.
  if (!requireView(user, res, 'query-fill')) return;
  const rows = await query<any>(`SELECT * FROM "QueryForm" WHERE active = TRUE ORDER BY "sortOrder", title`);
  const forms = rows.filter((f) => canFill(user, f));
  return res.json({ ok: true, forms });
}

async function createForm(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireView(user, res, 'queries')) return;
  if (user.role !== 'owner') return res.status(403).json({ ok: false, error: 'Owner only' });

  const parsed = FormBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const dup = await queryOne<any>(`SELECT id FROM "QueryForm" WHERE key = $1`, [b.key]);
  if (dup) return res.status(409).json({ ok: false, error: `A form with key "${b.key}" already exists` });

  const id = newId('qform');
  await query(
    `INSERT INTO "QueryForm"
       (id, key, title, description, fields, "fillRoles", "fillDepts", "viewRoles", "defaultClassify", active, "sortOrder", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
    [
      id, b.key, b.title, b.description || null, JSON.stringify(b.fields),
      b.fillRoles, b.fillDepts, b.viewRoles, b.defaultClassify || null,
      b.active ?? true, b.sortOrder ?? 0,
    ],
  );
  const row = await queryOne<any>(`SELECT * FROM "QueryForm" WHERE id = $1`, [id]);
  return res.json({ ok: true, form: row });
}
