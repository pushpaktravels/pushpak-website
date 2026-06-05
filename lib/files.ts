// ============================================================
// lib/files.ts — in-portal attachment store (SERVER ONLY).
// ============================================================
// Thin helpers over the "PortalFile" table (see scripts/add-portal-files.ts).
// Files live as BYTES inside our own Postgres, so accounts open them in the
// portal with no external-storage permission to manage. Access is gated by
// the SAME view that owns the parent record: whoever can see the parent can
// see its files (FILE_ENTITY_VIEW maps entityType → view key).
//
// Reused by Vendor Payments (item 4) and the Forms/Queries module (item 5).
// Imports lib/pg → never bundle into the browser.
// ============================================================
import { query, queryOne, newId } from '@/lib/pg';

// entityType → the view that owns the parent row. Adding a new attachable
// record type is a one-line change here (e.g. 'query' once item 5 lands).
export const FILE_ENTITY_VIEW: Record<string, string> = {
  'vendor-payment': 'vendor-pay',
};

export function viewForEntity(entityType: string): string | null {
  return FILE_ENTITY_VIEW[entityType] || null;
}

// Metadata only — never carries the bytes (those are streamed on demand by
// /api/files/[id]). Safe to send to the browser as a list.
export type FileMeta = {
  id: string;
  entityType: string;
  entityId: string;
  kind: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedByName: string | null;
  createdAt: string;
};

const META_COLS =
  `id, "entityType", "entityId", kind, "fileName", "mimeType", size, "uploadedByName", "createdAt"`;

export async function storeFile(args: {
  entityType: string;
  entityId: string;
  kind?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
  uploadedByExecId?: string | null;
  uploadedByName?: string | null;
}): Promise<FileMeta> {
  const id = newId('file');
  await query(
    `INSERT INTO "PortalFile"
       (id, "entityType", "entityId", kind, "fileName", "mimeType", size, content,
        "uploadedByExecId", "uploadedByName", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    [
      id, args.entityType, args.entityId, args.kind || null, args.fileName,
      args.mimeType, args.size, args.content,
      args.uploadedByExecId || null, args.uploadedByName || null,
    ],
  );
  const row = await queryOne<FileMeta>(
    `SELECT ${META_COLS} FROM "PortalFile" WHERE id = $1`, [id],
  );
  return row!;
}

export async function listFiles(entityType: string, entityId: string): Promise<FileMeta[]> {
  return query<FileMeta>(
    `SELECT ${META_COLS} FROM "PortalFile"
      WHERE "entityType" = $1 AND "entityId" = $2
      ORDER BY "createdAt" ASC`,
    [entityType, entityId],
  );
}

// Full row including bytes — for the streaming download route only.
export async function getFileWithContent(
  id: string,
): Promise<(FileMeta & { content: Buffer }) | null> {
  return queryOne<FileMeta & { content: Buffer }>(
    `SELECT ${META_COLS}, content FROM "PortalFile" WHERE id = $1`, [id],
  );
}

export async function getFileMeta(id: string): Promise<FileMeta | null> {
  return queryOne<FileMeta>(`SELECT ${META_COLS} FROM "PortalFile" WHERE id = $1`, [id]);
}

export async function deleteFile(id: string): Promise<void> {
  await query(`DELETE FROM "PortalFile" WHERE id = $1`, [id]);
}
