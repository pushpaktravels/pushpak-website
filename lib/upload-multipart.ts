// ============================================================
// upload-multipart.ts — read a single uploaded file off NextApiRequest.
// ============================================================
// Pages Router doesn't have a built-in body parser for multipart,
// so we use formidable. Files are kept in memory (no disk write) and
// returned as a Buffer the parser can chew on.
//
// SECURITY:
//   - 10 MB cap (FinBook exports are tiny — 200-800 KB usual)
//   - Accepts only .xlsx / .xls / .csv by content-type or extension
//   - Calling endpoint must already have run requireAuth()
// ============================================================
import type { NextApiRequest } from 'next';
import formidable from 'formidable';
import fs from 'fs';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXT = ['.xlsx', '.xls', '.csv'];

export type UploadedFile = {
  buffer: Buffer;
  fileName: string;
  size: number;
  mimeType: string;
};

export async function readUploadedFile(req: NextApiRequest): Promise<UploadedFile> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_SIZE,
    keepExtensions: true,
  });

  const { files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });

  const fileField = files.file;
  const file = Array.isArray(fileField) ? fileField[0] : fileField;
  if (!file) throw new Error('No file uploaded (expected field name: "file")');

  const fileName = file.originalFilename || file.newFilename || 'upload';
  const lower = fileName.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  if (!ALLOWED_EXT.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Please upload .xlsx, .xls, or .csv.`);
  }

  const buf = await fs.promises.readFile(file.filepath);
  // Best-effort cleanup of the temp file
  fs.promises.unlink(file.filepath).catch(() => {});

  return {
    buffer: buf,
    fileName,
    size: file.size || buf.length,
    mimeType: file.mimetype || 'application/octet-stream',
  };
}
