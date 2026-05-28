// ============================================================
// POST /api/upload/parse — preview a FinBook upload (no DB writes).
// ============================================================
// Owner/Admin only. Multipart form:
//   file        — the .xlsx / .xls / .csv
//   reportType  — 'agewise' | 'clientwise' | 'familywise'
//
// Routes to the right parser + diff builder, returns a slim preview
// payload (samples capped at 25 rows per category).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { query } from '@/lib/pg';
import { readUploadedFile, readFieldString } from '@/lib/upload-multipart';
import { parseFinBook, type ReportType } from '@/lib/upload-parser';
import {
  buildAgewisePlan, buildClientwisePlan, buildFamilywisePlan, buildCustomerMasterPlan,
  type CurrentAccount, type OpenPromise, type CurrentClient,
} from '@/lib/upload-diff';

export const config = { api: { bodyParser: false } };

const VALID: ReportType[] = ['agewise', 'clientwise', 'familywise', 'customermaster'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  let file; let reportType: ReportType;
  try {
    const up = await readUploadedFile(req);
    file = up.file;
    reportType = (readFieldString(up.fields, 'reportType') || 'agewise') as ReportType;
    if (!VALID.includes(reportType)) {
      return res.status(400).json({ ok: false, error: `Invalid reportType: ${reportType}` });
    }
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message || 'Bad upload' });
  }

  const parsed = parseFinBook(file.buffer, reportType);
  if (!parsed.ok) {
    return res.status(400).json({
      ok: false, error: parsed.error,
      headers: parsed.headers, sheetName: parsed.sheetName, warnings: parsed.warnings,
    });
  }

  const current = await query<CurrentAccount>(
    `SELECT party,
            COALESCE(bill,0)::float8 AS bill,
            COALESCE(d30,0)::float8 AS d30, COALESCE(d60,0)::float8 AS d60,
            COALESCE(d90,0)::float8 AS d90, COALESCE(d90p,0)::float8 AS d90p,
            exec, cm, family, branch,
            tier, "tierOverride", alert, "alertOverride",
            COALESCE("creditLimit",0)::float8 AS "creditLimit",
            "creditPeriod"
       FROM "Account"`
  );

  if (parsed.type === 'agewise') {
    const openPromises = await query<OpenPromise>(
      `SELECT id, party, "outstandingAt"::float8 AS "outstandingAt" FROM "Promise" WHERE status = 'Open'`
    );
    const plan = buildAgewisePlan(parsed.rows, current, openPromises);
    audit(req, user, 'UPLOAD_PREVIEW_AGEWISE', file.fileName, { rows: parsed.rows.length, summary: plan.summary });
    return res.json({
      ok: true, reportType: 'agewise',
      file: { name: file.fileName, size: file.size },
      sheetName: parsed.sheetName, headers: parsed.headers,
      grandTotal: parsed.grandTotal, warnings: parsed.warnings,
      summary: plan.summary,
      sample: {
        creates: plan.toCreate.slice(0, 25).map(p => ({ party: p.party, bill: p.bill, d30: p.d30, d60: p.d60, d90: p.d90, d90p: p.d90p })),
        updates: plan.toUpdate.slice(0, 25).map(u => ({ party: u.party, changes: u.changes, before: { bill: u.before.bill }, after: { bill: u.after.bill } })),
        closes:  plan.toClose.slice(0, 25).map(c => ({ party: c.party, before: { bill: c.before.bill } })),
        collections:    plan.collections.slice(0, 25),
        holds:          plan.newHoldCandidates.slice(0, 25),
        promisesKept:   plan.promisesKept.slice(0, 25),
        tierSuggestions:plan.tierSuggestions.slice(0, 25),
      },
    });
  }

  if (parsed.type === 'clientwise') {
    const plan = buildClientwisePlan(parsed.rows, current);
    audit(req, user, 'UPLOAD_PREVIEW_CLIENTWISE', file.fileName, { rows: parsed.rows.length, summary: plan.summary });
    return res.json({
      ok: true, reportType: 'clientwise',
      file: { name: file.fileName, size: file.size },
      sheetName: parsed.sheetName, headers: parsed.headers,
      grandTotal: parsed.grandTotal, warnings: parsed.warnings,
      emptyExecs: parsed.emptyExecs,
      summary: plan.summary,
      sample: {
        creates:  plan.toCreate.slice(0, 25),
        updates:  plan.toUpdate.slice(0, 25),
        ungrouped: plan.ungroupedRows.slice(0, 25),
      },
    });
  }

  if (parsed.type === 'familywise') {
    const plan = buildFamilywisePlan(parsed.rows, current);
    audit(req, user, 'UPLOAD_PREVIEW_FAMILYWISE', file.fileName, { rows: parsed.rows.length, summary: plan.summary });
    return res.json({
      ok: true, reportType: 'familywise',
      file: { name: file.fileName, size: file.size },
      sheetName: parsed.sheetName, headers: parsed.headers,
      grandTotal: parsed.grandTotal, warnings: parsed.warnings,
      emptyFamilies: parsed.emptyFamilies,
      summary: plan.summary,
      sample: {
        creates:  plan.toCreate.slice(0, 25),
        updates:  plan.toUpdate.slice(0, 25),
        ungrouped: plan.ungroupedRows.slice(0, 25),
      },
    });
  }

  // customermaster
  const currentClients = await query<CurrentClient>(
    `SELECT party, phone1, phone2, whatsapp, email, owner, address,
            COALESCE("creditLimit",0)::float8 AS "creditLimit",
            COALESCE("creditTerms",0)::int AS "creditTerms",
            vip, segment
       FROM "ClientMaster"`
  );
  const accountParties = new Set(current.map(c => c.party.toUpperCase()));
  const plan = buildCustomerMasterPlan(parsed.rows, currentClients, accountParties);
  audit(req, user, 'UPLOAD_PREVIEW_CUSTOMERMASTER', file.fileName, { rows: parsed.rows.length, summary: plan.summary });
  return res.json({
    ok: true, reportType: 'customermaster',
    file: { name: file.fileName, size: file.size },
    sheetName: parsed.sheetName, headers: parsed.headers,
    grandTotal: parsed.grandTotal, warnings: parsed.warnings,
    summary: plan.summary,
    sample: {
      creates: plan.toCreate.slice(0, 25).map(c => ({
        party: c.party, phone: c.phone1, email: c.email, owner: c.owner,
        creditLimit: c.creditLimit, creditTerms: c.creditTerms,
      })),
      updates: plan.toUpdate.slice(0, 25).map(u => ({
        party: u.party, changes: u.changes,
      })),
      noAccount: plan.noAccount.slice(0, 25),
    },
  });
}
