// ============================================================
// POST /api/upload/commit — apply a single FinBook upload.
// ============================================================
// Per-type commit endpoint, kept for one-at-a-time use. The main
// portal flow uses /api/upload/process-all which can apply all three
// reports in one atomic transaction. Both routes delegate to the
// same batched apply* helpers in lib/upload-commit, so 348-account
// refreshes finish in under 2 seconds instead of minutes.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { query, withTransaction } from '@/lib/pg';
import { readUploadedFile, readFieldString } from '@/lib/upload-multipart';
import { parseFinBook, type ReportType } from '@/lib/upload-parser';
import {
  buildAgewisePlan, buildClientwisePlan, buildFamilywisePlan,
  type CurrentAccount, type OpenPromise,
} from '@/lib/upload-diff';
import { applyAgewisePlan, applyClientwisePlan, applyFamilywisePlan } from '@/lib/upload-commit';

export const config = { api: { bodyParser: false } };

const VALID: ReportType[] = ['agewise', 'clientwise', 'familywise'];

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
    return res.status(400).json({ ok: false, error: parsed.error, headers: parsed.headers, warnings: parsed.warnings });
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

  try {
    if (parsed.type === 'agewise') {
      const openPromises = await query<OpenPromise>(
        `SELECT id, party, "outstandingAt"::float8 AS "outstandingAt" FROM "Promise" WHERE status = 'Open'`
      );
      const plan = buildAgewisePlan(parsed.rows, current, openPromises);
      await withTransaction(q => applyAgewisePlan(q, plan, { fileName: file.fileName, userExecId: user.execId }));
      audit(req, user, 'UPLOAD_COMMIT_AGEWISE', file.fileName, plan.summary);
      return res.json({ ok: true, reportType: 'agewise', summary: plan.summary, file: { name: file.fileName, size: file.size } });
    }
    if (parsed.type === 'clientwise') {
      const plan = buildClientwisePlan(parsed.rows, current);
      await withTransaction(q => applyClientwisePlan(q, plan, { fileName: file.fileName, userExecId: user.execId }));
      audit(req, user, 'UPLOAD_COMMIT_CLIENTWISE', file.fileName, plan.summary);
      return res.json({ ok: true, reportType: 'clientwise', summary: plan.summary, file: { name: file.fileName, size: file.size } });
    }
    const plan = buildFamilywisePlan(parsed.rows, current);
    await withTransaction(q => applyFamilywisePlan(q, plan, { fileName: file.fileName, userExecId: user.execId }));
    audit(req, user, 'UPLOAD_COMMIT_FAMILYWISE', file.fileName, plan.summary);
    return res.json({ ok: true, reportType: 'familywise', summary: plan.summary, file: { name: file.fileName, size: file.size } });
  } catch (err: any) {
    console.error('[api/upload/commit] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Refresh failed' });
  }
}
