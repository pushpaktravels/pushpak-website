// ============================================================
// /api/attendance/employees — list + enrich the employee master.
// ============================================================
// GET                         → all employees (+ "needs enrichment" flag)
// POST   { ...employee }      → create a new employee
// PATCH  { id, ...fields }    → update one employee (enrich a stub,
//                               set salary / weekly-off / shift / etc.)
//
// Stubs created by bootstrap-from-biometric carry hrCode "BIO-<code>"
// and salary 0; the UI flags these so the owner can fill real data.
//
// Auth: owner / admin only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';

const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, 'use HH:MM').nullable().optional();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullable().optional();

const Base = {
  machineCode: z.string().max(40).nullable().optional(),
  hrCode: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  department: z.string().max(80).nullable().optional(),
  designation: z.string().max(80).nullable().optional(),
  mobile: z.string().max(40).nullable().optional(),
  email: z.string().max(120).nullable().optional(),
  dob: dateStr,
  joiningDate: dateStr,
  monthlySalary: z.number().min(0).optional(),
  shiftIn: hhmm,
  shiftOut: hhmm,
  weeklyOffDay: z.number().int().min(0).max(6).optional(),
  leavesCarryOver: z.boolean().optional(),
  carryOverDays: z.number().min(0).optional(),
  active: z.boolean().optional(),
};

const CreateBody = z.object(Base);
const PatchBody = z.object({ id: z.string().min(1), ...Base, hrCode: Base.hrCode.optional() });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  if (req.method === 'GET') {
    const rows = await query(
      `SELECT id, "machineCode", "hrCode", name, department, designation, mobile, email,
              dob, "joiningDate", "monthlySalary", "shiftIn", "shiftOut", "weeklyOffDay",
              "leavesCarryOver", "carryOverDays", active, "createdAt", "updatedAt"
         FROM "Employee"
        ORDER BY active DESC, department NULLS LAST, name`,
    );
    return res.json({ ok: true, employees: rows });
  }

  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const d = parsed.data;

    const clashHr = await queryOne(`SELECT id FROM "Employee" WHERE "hrCode" = $1`, [d.hrCode]);
    if (clashHr) return res.status(409).json({ ok: false, error: `HR code ${d.hrCode} already exists` });
    if (d.machineCode) {
      const clashMc = await queryOne(`SELECT id FROM "Employee" WHERE "machineCode" = $1`, [d.machineCode]);
      if (clashMc) return res.status(409).json({ ok: false, error: `Machine code ${d.machineCode} already mapped` });
    }

    const id = newId('emp');
    await query(
      `INSERT INTO "Employee"
        (id, "machineCode", "hrCode", name, department, designation, mobile, email,
         dob, "joiningDate", "monthlySalary", "shiftIn", "shiftOut", "weeklyOffDay",
         "leavesCarryOver", "carryOverDays", active, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())`,
      [id, d.machineCode ?? null, d.hrCode, d.name, d.department ?? null, d.designation ?? null,
       d.mobile ?? null, d.email ?? null, d.dob ?? null, d.joiningDate ?? null,
       d.monthlySalary ?? 0, d.shiftIn ?? null, d.shiftOut ?? null, d.weeklyOffDay ?? 0,
       d.leavesCarryOver ?? false, d.carryOverDays ?? 0, d.active ?? true],
    );
    audit(req, user, 'EMPLOYEE_CREATE', id, { hrCode: d.hrCode, name: d.name });
    return res.json({ ok: true, id });
  }

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const d = parsed.data;
    const existing = await queryOne<any>(`SELECT * FROM "Employee" WHERE id = $1`, [d.id]);
    if (!existing) return res.status(404).json({ ok: false, error: 'Employee not found' });

    // uniqueness guards for the keys, ignoring self
    if (d.hrCode && d.hrCode !== existing.hrCode) {
      const clash = await queryOne(`SELECT id FROM "Employee" WHERE "hrCode" = $1 AND id <> $2`, [d.hrCode, d.id]);
      if (clash) return res.status(409).json({ ok: false, error: `HR code ${d.hrCode} already exists` });
    }
    if (d.machineCode && d.machineCode !== existing.machineCode) {
      const clash = await queryOne(`SELECT id FROM "Employee" WHERE "machineCode" = $1 AND id <> $2`, [d.machineCode, d.id]);
      if (clash) return res.status(409).json({ ok: false, error: `Machine code ${d.machineCode} already mapped` });
    }

    // Build a COALESCE-style partial update: only provided keys change.
    const fields: Record<string, any> = {
      machineCode: d.machineCode, hrCode: d.hrCode, name: d.name, department: d.department,
      designation: d.designation, mobile: d.mobile, email: d.email, dob: d.dob,
      joiningDate: d.joiningDate, monthlySalary: d.monthlySalary, shiftIn: d.shiftIn,
      shiftOut: d.shiftOut, weeklyOffDay: d.weeklyOffDay, leavesCarryOver: d.leavesCarryOver,
      carryOverDays: d.carryOverDays, active: d.active,
    };
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      sets.push(`"${k}" = $${i++}`);
      vals.push(v);
    }
    if (sets.length === 0) return res.json({ ok: true, unchanged: true });
    sets.push(`"updatedAt" = NOW()`);
    vals.push(d.id);
    await query(`UPDATE "Employee" SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    audit(req, user, 'EMPLOYEE_UPDATE', d.id, { changed: Object.keys(fields).filter((k) => (fields as any)[k] !== undefined) });
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
