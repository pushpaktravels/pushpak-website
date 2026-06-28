// ============================================================
// /api/me/documents — the caller's OWN personal documents.
// ============================================================
// Self-service ID-document locker. An employee uploads and manages their
// own papers (Aadhaar, PAN, bank passbook, address proof, photo). Hard-
// scoped to self: every file is stored against the caller's Employee row
// and can only ever be read / removed by that same employee.
//
//   GET                → list my documents (metadata only, no bytes).
//   POST (multipart)   → upload one document. fields: kind?, file
//
// These are sensitive PII, so every upload is audited (filename + kind,
// never the bytes). Bytes live in our own Postgres (PortalFile); nothing
// leaves to external storage.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { readUploadedAttachment, readFieldString } from '@/lib/upload-multipart';
import { storeFile, listFiles } from '@/lib/files';

export const config = { api: { bodyParser: false } };

// PortalFile.entityType used for personal documents.
export const ENTITY = 'employee-doc';
// The document kinds an employee may file; 'other' catches the rest.
const DOC_KINDS = ['aadhaar', 'pan', 'bank-passbook', 'address-proof', 'photo', 'other'];

async function myEmployee(execId: string) {
  return queryOne<any>(
    `SELECT id, name FROM "Employee" WHERE "loginExecId" = $1 AND active = TRUE`,
    [execId],
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const emp = await myEmployee(user.execId);
  if (!emp) {
    if (req.method === 'GET') return res.json({ ok: true, linked: false, files: [] });
    return res.status(400).json({ ok: false, error: "Your login isn't linked to an employee yet. Ask the owner to link it." });
  }

  if (req.method === 'GET') {
    const files = await listFiles(ENTITY, emp.id);
    return res.json({ ok: true, linked: true, files });
  }

  if (req.method === 'POST') {
    // Parse the multipart body first; nothing is persisted until it succeeds.
    let parsed;
    try { parsed = await readUploadedAttachment(req); }
    catch (e: any) { return res.status(400).json({ ok: false, error: e.message || 'Upload failed' }); }
    const { file, fields } = parsed;

    let kind = (readFieldString(fields, 'kind') || 'other').toLowerCase();
    if (!DOC_KINDS.includes(kind)) kind = 'other';

    const meta = await storeFile({
      entityType: ENTITY, entityId: emp.id, kind,
      fileName: file.fileName, mimeType: file.mimeType, size: file.size, content: file.buffer,
      uploadedByExecId: user.execId, uploadedByName: user.name,
    });
    audit(req, user, 'DOCUMENT_UPLOAD', emp.name, { fileId: meta.id, fileName: meta.fileName, size: meta.size, kind });
    return res.json({ ok: true, file: meta });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
