// ============================================================
// /api/files/[id] — stream one attachment (GET) or remove it (DELETE).
// ============================================================
//   GET    → stream the file bytes inline (Content-Disposition: inline) so
//            the browser previews PDFs/images; gated by the parent's view.
//   DELETE → remove the file; needs edit rights on the parent's view.
//
// The file's own entityType decides which view guards it, so a vendor-bill
// scan is reachable only by someone who can see Vendor Payments, etc.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { getFileWithContent, getFileMeta, deleteFile, viewForEntity } from '@/lib/files';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing file id' });

  if (req.method === 'GET') return stream(res, user, id);
  if (req.method === 'DELETE') return remove(req, res, user, id);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function stream(res: NextApiResponse, user: any, id: string) {
  const row = await getFileWithContent(id);
  if (!row) return res.status(404).json({ ok: false, error: 'File not found' });
  const view = viewForEntity(row.entityType);
  if (!view) return res.status(400).json({ ok: false, error: 'Unknown entity type' });
  if (!requireView(user, res, view)) return;

  const safeName = row.fileName.replace(/[^\w.\- ]+/g, '_');
  res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('Content-Length', String(row.content.length));
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(row.content);
}

async function remove(req: NextApiRequest, res: NextApiResponse, user: any, id: string) {
  const row = await getFileMeta(id);
  if (!row) return res.status(404).json({ ok: false, error: 'File not found' });
  const view = viewForEntity(row.entityType);
  if (!view) return res.status(400).json({ ok: false, error: 'Unknown entity type' });
  if (!requireViewEdit(user, res, view)) return;

  await deleteFile(id);
  audit(req, user, 'FILE_DELETE', `${row.entityType}:${row.entityId}`, { fileId: id, fileName: row.fileName });
  return res.json({ ok: true });
}
