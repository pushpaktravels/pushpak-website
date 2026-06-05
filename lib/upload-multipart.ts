// ============================================================
// upload-multipart.ts — read a single uploaded file off NextApiRequest.
// ============================================================
// Pages Router doesn't have a built-in body parser for multipart,
// so we use formidable. Returns the file as a Buffer along with
// the raw field map so callers can pull additional form data
// (e.g. reportType) via readFieldString().
//
// SECURITY:
//   - 10 MB cap (FinBook exports are tiny — ~30-80 KB typical)
//   - Only .xlsx / .xls / .csv by extension
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

export async function readUploadedFile(
  req: NextApiRequest
): Promise<{ file: UploadedFile; fields: formidable.Fields }> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_SIZE,
    keepExtensions: true,
  });

  const { fields, files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>(
    (resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    }
  );

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
  fs.promises.unlink(file.filepath).catch(() => {});

  return {
    file: {
      buffer: buf,
      fileName,
      size: file.size || buf.length,
      mimeType: file.mimetype || 'application/octet-stream',
    },
    fields,
  };
}

// ─── Attachments (bills / invoices / receipts / query files) ───
// Broader than the FinBook-export reader above: a bill or receipt is
// usually a PDF or a phone photo, not a spreadsheet. Same 10 MB cap.
// Bytes are handed back to the caller to persist (see lib/files.ts);
// formidable's temp file is deleted here.
const ATTACH_EXT = [
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic',
  '.xlsx', '.xls', '.csv', '.doc', '.docx',
];

export async function readUploadedAttachment(
  req: NextApiRequest,
): Promise<{ file: UploadedFile; fields: formidable.Fields }> {
  const form = formidable({ multiples: false, maxFileSize: MAX_SIZE, keepExtensions: true });
  const { fields, files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>(
    (resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    },
  );

  const fileField = files.file;
  const file = Array.isArray(fileField) ? fileField[0] : fileField;
  if (!file) throw new Error('No file uploaded (expected field name: "file")');

  const fileName = file.originalFilename || file.newFilename || 'upload';
  const lower = fileName.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  if (!ATTACH_EXT.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Allowed: PDF, image, or Office document.`);
  }

  const buf = await fs.promises.readFile(file.filepath);
  fs.promises.unlink(file.filepath).catch(() => {});
  return {
    file: {
      buffer: buf, fileName, size: file.size || buf.length,
      mimeType: file.mimetype || 'application/octet-stream',
    },
    fields,
  };
}

// Pull a single string value out of a formidable Fields map.
export function readFieldString(fields: formidable.Fields, name: string): string | null {
  const v = fields[name];
  if (v == null) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return String(v);
}

// ─── Multiple named files ──────────────────────────────────────
// For the combined endpoint that takes up to three FinBook exports
// at once. Returns a map { fieldName: UploadedFile } with only the
// fields that were actually uploaded.
export async function readUploadedFiles(
  req: NextApiRequest,
  expectedNames: string[],
): Promise<{ files: Record<string, UploadedFile>; fields: formidable.Fields }> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_SIZE,
    keepExtensions: true,
  });

  const { fields, files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>(
    (resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    }
  );

  const out: Record<string, UploadedFile> = {};
  for (const name of expectedNames) {
    const fileField = files[name];
    if (!fileField) continue;
    const f = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!f) continue;
    const fileName = f.originalFilename || f.newFilename || name;
    const lower = fileName.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf('.'));
    if (!ALLOWED_EXT.includes(ext)) {
      throw new Error(`Unsupported file type for ${name}: ${ext}. Please upload .xlsx, .xls, or .csv.`);
    }
    const buf = await fs.promises.readFile(f.filepath);
    fs.promises.unlink(f.filepath).catch(() => {});
    out[name] = {
      buffer: buf, fileName, size: f.size || buf.length,
      mimeType: f.mimetype || 'application/octet-stream',
    };
  }
  return { files: out, fields };
}
