// ============================================================
// /api/files — upload + list portal attachments (bills, receipts, …).
// ============================================================
//   POST (multipart)  fields: entityType, entityId, kind?, file
//                     → store the file in "PortalFile", return its metadata.
//   GET  ?entityType=&entityId=
//                     → list the metadata of every file on that record.
//
// Access is gated by the view that OWNS the parent record (FILE_ENTITY_VIEW):
// uploading needs edit rights on that view, listing needs read. Files live
// in our own Postgres — nothing here touches FinBook or external storage.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { readUploadedAttachment, readFieldString } from '@/lib/upload-multipart';
import { storeFile, listFiles, viewForEntity } from '@/lib/files';

export const config = { api: { bodyParser: false } };

// Confirm the parent record exists before hanging a file off it (so we never
// store orphan attachments) AND learn who created it. The creator's execId
// powers the ownership fallback below: a user who raised a record may attach
// its files even without the owning view's edit right. This is what lets an
// employee file the Vendor Payments form via Fill a Query and upload the
// required Bill, despite not holding 'vendor-pay' access — they only ever
// touch records they themselves created.
type ParentInfo = { exists: boolean; ownerExecId: string | null };

async function parentInfo(entityType: string, entityId: string): Promise<ParentInfo> {
  if (entityType === 'vendor-payment') {
    const row = await queryOne<any>(`SELECT "requestedByExecId" AS owner FROM "VendorPayment" WHERE id = $1`, [entityId]);
    return { exists: !!row, ownerExecId: row ? row.owner : null };
  }
  if (entityType === 'query') {
    const row = await queryOne<any>(`SELECT "submittedByExecId" AS owner FROM "Query" WHERE id = $1`, [entityId]);
    return { exists: !!row, ownerExecId: row ? row.owner : null };
  }
  return { exists: false, ownerExecId: null };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method === 'GET') return list(req, res, user);
  if (req.method === 'POST') return upload(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse, user: any) {
  const entityType = String(req.query.entityType || '');
  const entityId = String(req.query.entityId || '');
  if (!entityType || !entityId) return res.status(400).json({ ok: false, error: 'entityType and entityId are required' });

  const view = viewForEntity(entityType);
  if (!view) return res.status(400).json({ ok: false, error: 'Unknown entity type' });

  // The record's creator may always see its files; otherwise read needs the
  // owning view. (Existence is checked implicitly — a missing record has no
  // owner and no files.)
  const info = await parentInfo(entityType, entityId);
  const owns = !!info.ownerExecId && info.ownerExecId === user.execId;
  if (!owns && !requireView(user, res, view)) return;

  const files = await listFiles(entityType, entityId);
  return res.json({ ok: true, files });
}

async function upload(req: NextApiRequest, res: NextApiResponse, user: any) {
  // Read the multipart body first so we can pull entityType from the fields,
  // then gate. (No bytes are persisted until the checks below pass.)
  let parsed;
  try {
    parsed = await readUploadedAttachment(req);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message || 'Upload failed' });
  }
  const { file, fields } = parsed;

  const entityType = readFieldString(fields, 'entityType') || '';
  const entityId = readFieldString(fields, 'entityId') || '';
  const kind = readFieldString(fields, 'kind');
  if (!entityType || !entityId) return res.status(400).json({ ok: false, error: 'entityType and entityId are required' });

  const view = viewForEntity(entityType);
  if (!view) return res.status(400).json({ ok: false, error: 'Unknown entity type' });

  // Gate AND existence in one read: the creator may attach files to their own
  // record (ownership fallback); everyone else needs edit on the owning view.
  const info = await parentInfo(entityType, entityId);
  if (!info.exists) {
    return res.status(404).json({ ok: false, error: 'Parent record not found' });
  }
  const owns = !!info.ownerExecId && info.ownerExecId === user.execId;
  if (!owns && !requireViewEdit(user, res, view)) return;

  const meta = await storeFile({
    entityType, entityId, kind,
    fileName: file.fileName, mimeType: file.mimeType, size: file.size, content: file.buffer,
    uploadedByExecId: user.execId, uploadedByName: user.name,
  });
  audit(req, user, 'FILE_UPLOAD', `${entityType}:${entityId}`, { fileId: meta.id, fileName: meta.fileName, size: meta.size, kind });
  return res.json({ ok: true, file: meta });
}
