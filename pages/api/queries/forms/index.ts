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

const FieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'textarea', 'number', 'money', 'date', 'select', 'account']),
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

// Can this user fill this form? Owner always; otherwise an empty fillRoles
// means "everyone", else the role must be listed.
function canFill(user: any, fillRoles: string[]): boolean {
  if (user.role === 'owner') return true;
  if (!fillRoles || fillRoles.length === 0) return true;
  return fillRoles.includes(user.role);
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

  // Fill mode: forms the caller may fill. Needs the broad 'query-fill' view.
  if (!requireView(user, res, 'query-fill')) return;
  const rows = await query<any>(`SELECT * FROM "QueryForm" WHERE active = TRUE ORDER BY "sortOrder", title`);
  const forms = rows.filter((f) => canFill(user, f.fillRoles || []));
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
