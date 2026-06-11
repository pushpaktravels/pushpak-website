// ============================================================
// /api/vendors — the vendor/supplier master: search + add-new.
// ============================================================
//   GET  ?q=<name>&all=1  → vendors matching the query (active only unless
//                           all=1, which the Vendors admin page uses).
//   POST {name, contact?, gstin?, notes?}  → add a vendor to the master.
//
// Reading is broad (any desk that fills a form or makes a booking needs to
// search vendors) — gated on the same 'query-fill' capability that lets a
// user file a Vendor Payments form, which also keeps insights-only identities
// out. Creating is for the booking/accounts desks only. Portal-only; nothing
// here touches FinBook.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, canEditView } from '@/lib/views';
import { audit } from '@/lib/audit';

// Desks allowed to grow the master. A form-filler without one of these can
// still TYPE a vendor name (free-text fallback) — they just can't persist it.
const CREATE_VIEWS = ['vendor-pay', 'reservations', 'card-log'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  // Broad read gate that still excludes insights-only identities.
  if (!requireView(user, res, 'query-fill')) return;

  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return create(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse) {
  const q = String(req.query.q || '').trim();
  const all = req.query.all === '1' || req.query.all === 'true';

  const where: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (!all) where.push(`active = TRUE`);
  if (q) { where.push(`name ILIKE $${i++}`); params.push(`%${q}%`); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query<any>(
    `SELECT id, name, contact, gstin, notes, active FROM "Vendor" ${whereSql} ORDER BY name LIMIT 50`,
    params,
  );
  return res.json({ ok: true, vendors: rows });
}

const CreateBody = z.object({
  name:    z.string().min(1).max(120).transform(s => s.trim()),
  contact: z.string().max(120).optional().nullable(),
  gstin:   z.string().max(40).optional().nullable(),
  notes:   z.string().max(2000).optional().nullable(),
});

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!CREATE_VIEWS.some(v => canEditView(user, v))) {
    return res.status(403).json({ ok: false, error: 'Not allowed to add a vendor' });
  }
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  // Idempotent add-new: if a vendor with this name (case-insensitive) already
  // exists, return it rather than erroring — the picker treats both the same.
  const existing = await queryOne<any>(`SELECT id, name, contact, gstin, notes, active FROM "Vendor" WHERE LOWER(name) = LOWER($1) LIMIT 1`, [b.name]);
  if (existing) return res.json({ ok: true, vendor: existing, existed: true });

  const id = newId('vnd');
  await query(
    `INSERT INTO "Vendor" (id, name, contact, gstin, notes, active, "createdBy", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,TRUE,$6,NOW(),NOW())`,
    [id, b.name, b.contact || null, b.gstin || null, b.notes || null, user.execId],
  );
  audit(req, user, 'VENDOR_CREATE', b.name, { id });
  const row = await queryOne<any>(`SELECT id, name, contact, gstin, notes, active FROM "Vendor" WHERE id = $1`, [id]);
  return res.json({ ok: true, vendor: row });
}
