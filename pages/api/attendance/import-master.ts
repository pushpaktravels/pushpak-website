// ============================================================
// POST /api/attendance/import-master — import the Employee Master.
// ============================================================
// Multipart field "file": the "Pushapk Employee Master" sheet
// (.xls/.xlsx/.csv). Columns detected case-insensitively:
//   Name | Employees Code with Name (E-001 …) | Email | Mobile |
//   Designation | DOB | Present Address | Permanent Address
//
// Upserts employees by hrCode. Salary / shift / weekly-off / machineCode
// are NEVER overwritten here (those are enriched separately) — this only
// fills identity/contact fields.
//
// Then runs auto-match-by-name: biometric-bootstrapped stubs (hrCode
// "BIO-*", carrying a machineCode) are matched to freshly-imported
// master rows that still lack a machineCode, and returned as PROPOSALS
// for the owner to confirm via /api/attendance/match-codes.
//
// Auth: owner / admin only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { requireAuth } from '@/lib/auth';
import { requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { query, queryOne, newId } from '@/lib/pg';
import { readUploadedFile } from '@/lib/upload-multipart';
import { normalizeName, nameMatchScore } from '@/lib/attendance-match';

export const config = { api: { bodyParser: false } };

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function toStr(v: any): string { return v == null ? '' : String(v).trim(); }

function parseDate(s: string): string | null {
  s = toStr(s);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[A-Za-z]*[-/\s](\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${String(m[1]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // DD/MM/YYYY
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

// Pull "E-001" out of "E-001 - John Doe" / "E-001" / "John (E-001)".
function extractHrCode(raw: string): string | null {
  const m = toStr(raw).match(/E[-\s]?\d{1,4}/i);
  return m ? m[0].toUpperCase().replace(/\s/g, '').replace(/^E/, 'E-').replace('E--', 'E-') : null;
}

function findCol(headers: string[], ...cands: string[]): number {
  const norm = headers.map((h) => toStr(h).toLowerCase().replace(/\s+/g, ' '));
  for (const c of cands) {
    const t = c.toLowerCase();
    const i = norm.indexOf(t);
    if (i >= 0) return i;
  }
  for (const c of cands) {
    const t = c.toLowerCase();
    const i = norm.findIndex((h) => h.includes(t));
    if (i >= 0) return i;
  }
  return -1;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireViewEdit(user, res, 'employees')) return;

  let file;
  try {
    const r = await readUploadedFile(req);
    file = r.file;
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || 'Upload failed' });
  }

  let grid: any[][];
  try {
    const wb = XLSX.read(file.buffer, { type: 'buffer', raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', blankrows: false, raw: false });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: `Couldn't open file: ${e?.message || 'unknown'}` });
  }
  if (grid.length === 0) return res.status(400).json({ ok: false, error: 'Sheet is empty.' });

  // Find the header row (one that mentions "name").
  let headerRow = -1;
  for (let i = 0; i < Math.min(15, grid.length); i++) {
    const joined = (grid[i] || []).map(toStr).join(' ').toLowerCase();
    if (joined.includes('name')) { headerRow = i; break; }
  }
  if (headerRow < 0) return res.status(400).json({ ok: false, error: 'Could not find a header row containing "Name".' });

  const headers = (grid[headerRow] || []).map(toStr);
  const cName = findCol(headers, 'name');
  const cCode = findCol(headers, 'employees code with name', 'employee code', 'code', 'emp code', 'employee code with name');
  const cEmail = findCol(headers, 'email', 'email id', 'e-mail');
  const cMobile = findCol(headers, 'mobile', 'phone', 'contact', 'mobile no');
  const cDesig = findCol(headers, 'designation', 'role', 'title');
  const cDob = findCol(headers, 'dob', 'date of birth', 'birth');
  const cPresent = findCol(headers, 'present address', 'current address', 'present');
  const cPermanent = findCol(headers, 'permanent address', 'permanent');

  if (cName < 0) return res.status(400).json({ ok: false, error: 'No "Name" column found.' });

  let created = 0, updated = 0, skipped = 0;
  const warnings: string[] = [];

  for (let i = headerRow + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const name = toStr(r[cName]);
    if (!name) continue;
    const hrCode = cCode >= 0 ? extractHrCode(toStr(r[cCode])) : null;
    if (!hrCode) { skipped++; warnings.push(`Row ${i + 1} (${name}): no E-code found, skipped.`); continue; }

    const existing = await queryOne<any>(`SELECT id FROM "Employee" WHERE "hrCode" = $1`, [hrCode]);
    const email = cEmail >= 0 ? toStr(r[cEmail]) || null : null;
    const mobile = cMobile >= 0 ? toStr(r[cMobile]) || null : null;
    const desig = cDesig >= 0 ? toStr(r[cDesig]) || null : null;
    const dob = cDob >= 0 ? parseDate(toStr(r[cDob])) : null;
    const present = cPresent >= 0 ? toStr(r[cPresent]) || null : null;
    const permanent = cPermanent >= 0 ? toStr(r[cPermanent]) || null : null;

    if (existing) {
      await query(
        `UPDATE "Employee" SET
           name = $1, email = COALESCE($2, email), mobile = COALESCE($3, mobile),
           designation = COALESCE($4, designation), dob = COALESCE($5, dob),
           "presentAddress" = COALESCE($6, "presentAddress"),
           "permanentAddress" = COALESCE($7, "permanentAddress"),
           "updatedAt" = NOW()
         WHERE id = $8`,
        [name, email, mobile, desig, dob, present, permanent, existing.id],
      );
      updated++;
    } else {
      await query(
        `INSERT INTO "Employee"
          (id, "hrCode", name, email, mobile, designation, dob,
           "presentAddress", "permanentAddress", "weeklyOffDay", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,NOW(),NOW())`,
        [newId('emp'), hrCode, name, email, mobile, desig, dob, present, permanent],
      );
      created++;
    }
  }

  // ─── Auto-match-by-name ──────────────────────────────────────
  // Stubs = have a machineCode but a placeholder BIO-* hrCode.
  // Targets = real master rows (non-BIO hrCode) with no machineCode yet.
  const stubs = await query(
    `SELECT id, "machineCode", name FROM "Employee"
      WHERE "machineCode" IS NOT NULL AND "hrCode" LIKE 'BIO-%'`,
  );
  const targets = await query(
    `SELECT id, "hrCode", name FROM "Employee"
      WHERE "machineCode" IS NULL AND "hrCode" NOT LIKE 'BIO-%'`,
  );

  const proposals: Array<{
    stubId: string; machineCode: string; stubName: string;
    masterId: string; masterHrCode: string; masterName: string;
    score: number; confidence: 'high' | 'medium' | 'low';
  }> = [];
  for (const s of stubs as any[]) {
    let best: any = null;
    let bestScore = 0;
    for (const t of targets as any[]) {
      const score = nameMatchScore(normalizeName(s.name), normalizeName(t.name));
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best && bestScore >= 0.5) {
      proposals.push({
        stubId: s.id, machineCode: s.machineCode, stubName: s.name,
        masterId: best.id, masterHrCode: best.hrCode, masterName: best.name,
        score: Number(bestScore.toFixed(2)),
        confidence: bestScore >= 0.95 ? 'high' : bestScore >= 0.7 ? 'medium' : 'low',
      });
    }
  }

  audit(req, user, 'EMPLOYEE_MASTER_IMPORT', file.fileName, { created, updated, skipped });

  return res.json({
    ok: true,
    summary: { created, updated, skipped, warnings: warnings.slice(0, 20), proposals },
  });
}
