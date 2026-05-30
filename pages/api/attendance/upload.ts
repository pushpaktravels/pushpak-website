// ============================================================
// POST /api/attendance/upload — ingest biometric daily reports.
// ============================================================
// Multipart fields (each optional, at least one required):
//   file_today      — today's export (IN only; OUT not yet finalized)
//   file_yesterday  — yesterday's export (IN + finalized OUT)
//
// Processing is driven by each file's OWN banner date, not the field
// name — so uploading yesterday+today simply upserts two dates. A later
// re-upload of a date finalizes its OUT and re-classifies. Unknown
// machine codes are bootstrapped into Employee stubs for enrichment.
//
// Auth: owner / admin only (attendance is HR-sensitive).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/lib/auth';
import { requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { withTransaction, newId } from '@/lib/pg';
import { readUploadedFiles } from '@/lib/upload-multipart';
import { parseBiometric, type BiometricRow } from '@/lib/attendance-parser';
import { ensureEmployees, loadDayContext, upsertAttendance } from '@/lib/attendance-db';

export const config = { api: { bodyParser: false } };

type FileSummary = {
  fileName: string;
  reportDate: string | null;
  rows: number;
  warnings: string[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireViewEdit(user, res, 'attendance')) return;

  let files;
  try {
    const r = await readUploadedFiles(req, ['file_today', 'file_yesterday']);
    files = r.files;
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || 'Upload failed' });
  }

  const uploaded = Object.values(files);
  if (uploaded.length === 0) {
    return res.status(400).json({ ok: false, error: 'No file uploaded. Expected file_today and/or file_yesterday.' });
  }

  // Parse every file up-front so a bad file fails before we write anything.
  const parsedFiles: { fileName: string; reportDate: string; rows: BiometricRow[]; warnings: string[] }[] = [];
  const fileSummaries: FileSummary[] = [];
  for (const f of uploaded) {
    const p = parseBiometric(f.buffer);
    if (!p.ok) {
      return res.status(400).json({ ok: false, error: `${f.fileName}: ${p.error}` });
    }
    if (!p.reportDate) {
      return res.status(400).json({
        ok: false,
        error: `${f.fileName}: couldn't read the attendance date from the file. Please check it's the right report.`,
      });
    }
    parsedFiles.push({ fileName: f.fileName, reportDate: p.reportDate, rows: p.rows, warnings: p.warnings });
    fileSummaries.push({ fileName: f.fileName, reportDate: p.reportDate, rows: p.rows.length, warnings: p.warnings });
  }

  // Union of all rows for one-shot employee bootstrap.
  const allRows = parsedFiles.flatMap((p) => p.rows);

  try {
    const result = await withTransaction(async (q) => {
      const { byCode, created } = await ensureEmployees(q, allRows);

      let daysUpserted = 0;
      let unmatched = 0;
      const matchedCodes = new Set<string>();
      const datesTouched = new Set<string>();

      // Cache per-date context so we don't re-query holidays/leaves per row.
      const ctxCache = new Map<string, Awaited<ReturnType<typeof loadDayContext>>>();

      for (const pf of parsedFiles) {
        let ctx = ctxCache.get(pf.reportDate);
        if (!ctx) {
          ctx = await loadDayContext(q, pf.reportDate);
          ctxCache.set(pf.reportDate, ctx);
        }
        for (const row of pf.rows) {
          const emp = byCode.get(row.machineCode);
          if (!emp) { unmatched++; continue; }
          matchedCodes.add(row.machineCode);
          await upsertAttendance(q, emp, pf.reportDate, row, ctx);
          daysUpserted++;
        }
        datesTouched.add(pf.reportDate);
      }

      // Upload log (one row covering this multi-file submission).
      const latestDate = Array.from(datesTouched).sort().pop() || null;
      await q(
        `INSERT INTO "AttendanceUpload"
          (id, ts, "byWhom", "fileNames", "reportDate", "rowsParsed", matched, unmatched, "daysUpserted", notes)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newId('attup'), user.name,
          parsedFiles.map((p) => p.fileName).join(', '),
          latestDate, allRows.length, matchedCodes.size, unmatched, daysUpserted,
          created > 0 ? `${created} new employee stub(s) created` : null,
        ],
      );

      return { created, daysUpserted, unmatched, matched: matchedCodes.size, dates: Array.from(datesTouched).sort() };
    });

    audit(req, user, 'ATTENDANCE_UPLOAD', result.dates.join(','), {
      files: fileSummaries.map((f) => f.fileName),
      daysUpserted: result.daysUpserted,
      newEmployees: result.created,
    });

    return res.json({
      ok: true,
      summary: {
        files: fileSummaries,
        dates: result.dates,
        daysUpserted: result.daysUpserted,
        newEmployees: result.created,
        matched: result.matched,
        unmatched: result.unmatched,
      },
    });
  } catch (err: any) {
    console.error('[api/attendance/upload] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Upload processing failed' });
  }
}
