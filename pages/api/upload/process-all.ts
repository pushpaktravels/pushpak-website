// ============================================================
// POST /api/upload/process-all — atomic 3-file refresh.
// ============================================================
// Accepts up to three named files in one multipart request:
//   file_agewise        — Agewise FinBook report
//   file_familywise     — Familywise FinBook report
//   file_clientwise     — Clientwise (a.k.a. "collectionwise") report
//
// Any subset may be provided. They are parsed, diffed against the
// current Account snapshot, and applied in a SINGLE withTransaction
// in the order: agewise → familywise → clientwise. Order matters so
// the financial-truth refresh happens first; the metadata uploads
// then annotate the resulting accounts.
//
// Owner / Admin only. Atomic: any failure rolls every write back.
// Per-table writes are batched via UNNEST so a 350-account refresh
// completes in ~1 round-trip per table.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { query, withTransaction } from '@/lib/pg';
import { readUploadedFiles } from '@/lib/upload-multipart';
import { parseFinBook } from '@/lib/upload-parser';
import {
  buildAgewisePlan, buildClientwisePlan, buildFamilywisePlan,
  type CurrentAccount, type OpenPromise,
} from '@/lib/upload-diff';
import {
  applyAgewisePlan, applyClientwisePlan, applyFamilywisePlan,
} from '@/lib/upload-commit';

export const config = { api: { bodyParser: false } };

const FIELDS = ['file_agewise', 'file_familywise', 'file_clientwise'] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  const tStart = Date.now();
  let files: Record<string, any>;
  try {
    const up = await readUploadedFiles(req, FIELDS as any);
    files = up.files;
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message || 'Bad upload' });
  }

  const provided = Object.keys(files);
  if (provided.length === 0) {
    return res.status(400).json({ ok: false, error: 'No files uploaded. Pick at least one report.' });
  }

  // Parse every provided file first so we fail fast on bad input
  // BEFORE we open the transaction.
  const parsed: Record<string, any> = {};
  for (const fieldName of provided) {
    const type =
      fieldName === 'file_agewise'    ? 'agewise' :
      fieldName === 'file_familywise' ? 'familywise' :
                                        'clientwise';
    const r = parseFinBook(files[fieldName].buffer, type);
    if (!r.ok) {
      return res.status(400).json({
        ok: false,
        error: `${type} parse failed: ${r.error}`,
        which: type,
        headers: r.headers,
      });
    }
    parsed[fieldName] = r;
  }

  // Snapshot the DB once.
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

  // Build plans (without touching the DB yet so we can return a
  // single combined summary even on failure).
  let agewisePlan: any = null;
  let familywisePlan: any = null;
  let clientwisePlan: any = null;

  if (parsed.file_agewise) {
    const openPromises = await query<OpenPromise>(
      `SELECT id, party, "outstandingAt"::float8 AS "outstandingAt" FROM "Promise" WHERE status = 'Open'`
    );
    agewisePlan = buildAgewisePlan(parsed.file_agewise.rows, current, openPromises);
  }
  if (parsed.file_familywise) {
    familywisePlan = buildFamilywisePlan(parsed.file_familywise.rows, current);
  }
  if (parsed.file_clientwise) {
    clientwisePlan = buildClientwisePlan(parsed.file_clientwise.rows, current);
  }

  try {
    await withTransaction(async (q) => {
      if (agewisePlan)    await applyAgewisePlan   (q, agewisePlan,    { fileName: files.file_agewise.fileName,    userExecId: user.execId });
      if (familywisePlan) await applyFamilywisePlan(q, familywisePlan, { fileName: files.file_familywise.fileName, userExecId: user.execId });
      if (clientwisePlan) await applyClientwisePlan(q, clientwisePlan, { fileName: files.file_clientwise.fileName, userExecId: user.execId });
    });
  } catch (err: any) {
    console.error('[api/upload/process-all] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Refresh failed' });
  }

  const elapsedMs = Date.now() - tStart;
  const summary = {
    agewise:    agewisePlan    ? agewisePlan.summary    : null,
    familywise: familywisePlan ? familywisePlan.summary : null,
    clientwise: clientwisePlan ? clientwisePlan.summary : null,
    elapsedMs,
  };
  audit(req, user, 'UPLOAD_PROCESS_ALL', provided.join(','), summary);
  return res.json({ ok: true, summary });
}
