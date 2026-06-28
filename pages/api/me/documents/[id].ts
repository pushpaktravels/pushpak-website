// ============================================================
// /api/me/documents/[id] — stream (GET) ONE of my docs.
// ============================================================
// Strictly self-scoped: the file must be an 'employee-doc' that belongs to
// the caller's OWN Employee row, so one employee can never reach another's
// papers by guessing an id. Viewing this sensitive PII is audited.
//
// Read-only by design: employees upload and view their own papers but cannot
// delete them — once a document is on file it stays, so an employee can't
// quietly drop an ID after it's been filed. Removal, if ever needed, is an
// office/owner action, not a self-service one.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { getFileWithContent } from '@/lib/files';

const ENTITY = 'employee-doc';

async function myEmployeeId(execId: string): Promise<string | null> {
  const e = await queryOne<any>(`SELECT id FROM "Employee" WHERE "loginExecId" = $1 AND active = TRUE`, [execId]);
  return e ? e.id : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing file id' });

  const empId = await myEmployeeId(user.execId);
  if (!empId) return res.status(403).json({ ok: false, error: 'Not linked to an employee' });

  if (req.method === 'GET') {
    const row = await getFileWithContent(id);
    // 404 (not 403) on a mismatch so we never confirm another employee's file exists.
    if (!row || row.entityType !== ENTITY || row.entityId !== empId) {
      return res.status(404).json({ ok: false, error: 'File not found' });
    }
    audit(req, user, 'DOCUMENT_VIEW', row.kind || 'other', { fileId: id, fileName: row.fileName });
    const safeName = row.fileName.replace(/[^\w.\- ]+/g, '_');
    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Content-Length', String(row.content.length));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(row.content);
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
