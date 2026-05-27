// ============================================================
// POST /api/upload/parse — preview a FinBook upload (no DB writes).
// ============================================================
// Owner/Admin only. Accepts a single multipart "file" field, parses
// the workbook, diffs against the current Account snapshot, and
// returns a full plan + summary the UI shows for confirmation.
//
// Nothing is persisted by this endpoint — that's /api/upload/commit.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { query } from '@/lib/pg';
import { readUploadedFile } from '@/lib/upload-multipart';
import { parseWorkbookBuffer } from '@/lib/upload-parser';
import { buildDiffPlan, type CurrentAccount, type OpenPromise } from '@/lib/upload-diff';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  let file;
  try {
    file = await readUploadedFile(req);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message || 'Bad upload' });
  }

  const parsed = parseWorkbookBuffer(file.buffer, { fileName: file.fileName });
  if (!parsed.ok) {
    return res.status(400).json({
      ok: false,
      error: parsed.error,
      headers: parsed.headers,
      sheetName: parsed.sheetName,
      warnings: parsed.warnings,
    });
  }

  // Pull a minimal snapshot of every account
  const current = await query<CurrentAccount>(
    `SELECT party,
            COALESCE(bill,        0)::float8        AS bill,
            COALESCE(d30,         0)::float8        AS d30,
            COALESCE(d60,         0)::float8        AS d60,
            COALESCE(d90,         0)::float8        AS d90,
            COALESCE(d90p,        0)::float8        AS d90p,
            exec, cm, family, branch,
            tier, "tierOverride", alert, "alertOverride",
            COALESCE("creditLimit", 0)::float8       AS "creditLimit",
            "creditPeriod"
       FROM "Account"`
  );

  const openPromises = await query<OpenPromise>(
    `SELECT id, party, "outstandingAt"::float8 AS "outstandingAt"
       FROM "Promise"
      WHERE status = 'Open'`
  );

  const plan = buildDiffPlan(parsed.rows!, current, openPromises);

  audit(req, user, 'UPLOAD_PREVIEW', file.fileName, {
    rowCount: parsed.rows!.length,
    summary: plan.summary,
  });

  // Slim the preview payload — don't ship every change to the browser
  // when the file has 5,000 rows.
  return res.json({
    ok: true,
    file: { name: file.fileName, size: file.size },
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    columnMap: parsed.columnMap,
    warnings: parsed.warnings,
    summary: plan.summary,
    sample: {
      creates: plan.toCreate.slice(0, 25).map(p => ({
        party: p.party, exec: p.exec, family: p.family, bill: p.bill,
        d30: p.d30, d60: p.d60, d90: p.d90, d90p: p.d90p,
      })),
      updates: plan.toUpdate.slice(0, 25).map(u => ({
        party: u.party, changes: u.changes,
        before: { bill: u.before.bill }, after: { bill: u.after.bill },
      })),
      closes: plan.toClose.slice(0, 25).map(c => ({ party: c.party, before: { bill: c.before.bill } })),
      collections: plan.collections.slice(0, 25),
      holds: plan.newHoldCandidates.slice(0, 25),
      promisesKept: plan.promisesKept.slice(0, 25),
      tierSuggestions: plan.tierSuggestions.slice(0, 25),
    },
  });
}
