// ============================================================
// lib/tasks.ts — the shared task / reminder engine.
// ============================================================
// One server-side surface every department calls instead of hand-rolling
// its own reminders. The Domestic Reservations hold-clock, travel
// reminders, Visa appointments, Package vouchers and Lead follow-ups all
// create Tasks here; the Tasks page + dashboard "Due today" widget + the
// reminder cron all read from here.
//
// Polymorphic by design: a Task points at any record via
// (relatedType, relatedId) with a denormalised relatedLabel for display,
// so no per-department foreign key is needed. Runtime access is raw SQL
// via lib/pg (Prisma client is schema/types only in this codebase).
// ============================================================
import { query, queryOne, newId } from './pg';

export type TaskKind =
  | 'reservation_hold'
  | 'travel_reminder'
  | 'visa_appointment'
  | 'package_voucher'
  | 'lead_followup'
  | 'promise'
  | 'generic';

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'snoozed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type TaskRow = {
  id: string;
  kind: string;
  title: string;
  details: string | null;
  department: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  remindAt: string | null;
  snoozedUntil: string | null;
  assigneeExecId: string | null;
  assigneeName: string | null;
  createdBy: string | null;
  relatedType: string | null;
  relatedId: string | null;
  relatedLabel: string | null;
  meta: any | null;
  doneAt: string | null;
  doneBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskInput = {
  kind?: TaskKind;
  title: string;
  details?: string | null;
  department?: string | null;
  priority?: TaskPriority;
  dueAt?: Date | string | null;
  remindAt?: Date | string | null;
  assigneeExecId?: string | null;
  assigneeName?: string | null;
  createdBy?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  relatedLabel?: string | null;
  meta?: Record<string, any> | null;
};

const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : (v instanceof Date ? v.toISOString() : v);

// Create a task. If remindAt is omitted it defaults to dueAt, so a task
// surfaces exactly when it comes due unless a caller wants an earlier nudge.
export async function createTask(input: CreateTaskInput): Promise<TaskRow> {
  const id = newId('task');
  const dueAt = iso(input.dueAt);
  const remindAt = iso(input.remindAt) ?? dueAt;
  const rows = await query<TaskRow>(
    `INSERT INTO "Task"
       (id, kind, title, details, department, status, priority,
        "dueAt", "remindAt", "assigneeExecId", "assigneeName", "createdBy",
        "relatedType", "relatedId", "relatedLabel", meta, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW(), NOW())
     RETURNING *`,
    [
      id,
      input.kind ?? 'generic',
      input.title,
      input.details ?? null,
      input.department ?? null,
      input.priority ?? 'normal',
      dueAt,
      remindAt,
      input.assigneeExecId ?? null,
      input.assigneeName ?? null,
      input.createdBy ?? null,
      input.relatedType ?? null,
      input.relatedId ?? null,
      input.relatedLabel ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
    ]
  );
  return rows[0];
}

// Idempotent upsert for system-generated tasks (e.g. one hold-expiry task
// per reservation): if an OPEN task already exists for this (kind,
// relatedType, relatedId) we update it in place instead of duplicating.
export async function upsertSystemTask(
  match: { kind: TaskKind; relatedType: string; relatedId: string },
  input: CreateTaskInput,
): Promise<TaskRow> {
  const existing = await queryOne<TaskRow>(
    `SELECT * FROM "Task"
      WHERE kind = $1 AND "relatedType" = $2 AND "relatedId" = $3
        AND status IN ('open','in_progress','snoozed')
      ORDER BY "createdAt" DESC LIMIT 1`,
    [match.kind, match.relatedType, match.relatedId]
  );
  if (!existing) {
    return createTask({ ...input, kind: match.kind, relatedType: match.relatedType, relatedId: match.relatedId });
  }
  const dueAt = iso(input.dueAt);
  const remindAt = iso(input.remindAt) ?? dueAt;
  const rows = await query<TaskRow>(
    `UPDATE "Task"
        SET title = $2, details = $3, department = COALESCE($4, department),
            priority = $5, "dueAt" = $6, "remindAt" = $7,
            "assigneeExecId" = COALESCE($8, "assigneeExecId"),
            "assigneeName" = COALESCE($9, "assigneeName"),
            "relatedLabel" = COALESCE($10, "relatedLabel"),
            meta = COALESCE($11, meta),
            "updatedAt" = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      existing.id,
      input.title,
      input.details ?? null,
      input.department ?? null,
      input.priority ?? existing.priority,
      dueAt,
      remindAt,
      input.assigneeExecId ?? null,
      input.assigneeName ?? null,
      input.relatedLabel ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
    ]
  );
  return rows[0];
}

export async function completeTask(id: string, byExecId: string | null): Promise<void> {
  await query(
    `UPDATE "Task" SET status='done', "doneAt"=NOW(), "doneBy"=$2, "updatedAt"=NOW() WHERE id=$1`,
    [id, byExecId]
  );
}

export async function cancelOpenTasksFor(relatedType: string, relatedId: string): Promise<void> {
  await query(
    `UPDATE "Task" SET status='cancelled', "updatedAt"=NOW()
      WHERE "relatedType"=$1 AND "relatedId"=$2 AND status IN ('open','in_progress','snoozed')`,
    [relatedType, relatedId]
  );
}

export async function snoozeTask(id: string, until: Date | string): Promise<void> {
  await query(
    `UPDATE "Task" SET status='snoozed', "snoozedUntil"=$2, "remindAt"=$2, "updatedAt"=NOW() WHERE id=$1`,
    [id, iso(until)]
  );
}

export type TaskFilter = {
  assigneeExecId?: string | null; // null = no filter; string = scope to one owner
  department?: string | null;
  kind?: string | null;
  status?: string | null;        // defaults to active (not done/cancelled)
  relatedType?: string | null;
  relatedId?: string | null;
  dueBefore?: Date | string | null;
  limit?: number;
};

// List tasks with flexible scoping. Defaults to ACTIVE tasks ordered by
// soonest due. Used by the Tasks board, the dashboard widget and the cron.
export async function listTasks(f: TaskFilter = {}): Promise<TaskRow[]> {
  const where: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (f.status) { where.push(`status = $${i++}`); params.push(f.status); }
  else { where.push(`status IN ('open','in_progress','snoozed')`); }

  if (f.assigneeExecId) { where.push(`"assigneeExecId" = $${i++}`); params.push(f.assigneeExecId); }
  if (f.department)     { where.push(`department = $${i++}`); params.push(f.department); }
  if (f.kind)           { where.push(`kind = $${i++}`); params.push(f.kind); }
  if (f.relatedType)    { where.push(`"relatedType" = $${i++}`); params.push(f.relatedType); }
  if (f.relatedId)      { where.push(`"relatedId" = $${i++}`); params.push(f.relatedId); }
  if (f.dueBefore)      { where.push(`"dueAt" IS NOT NULL AND "dueAt" <= $${i++}`); params.push(iso(f.dueBefore)); }

  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  return query<TaskRow>(
    `SELECT * FROM "Task"
      WHERE ${where.join(' AND ')}
      ORDER BY ("dueAt" IS NULL), "dueAt" ASC, "createdAt" DESC
      LIMIT ${limit}`,
    params
  );
}

// Reminders that should fire now: active, remindAt has passed, and not
// snoozed into the future. Drives the dashboard badge + reminder cron.
export async function dueReminders(execId?: string | null): Promise<TaskRow[]> {
  const where: string[] = [
    `status IN ('open','in_progress','snoozed')`,
    `"remindAt" IS NOT NULL AND "remindAt" <= NOW()`,
    `("snoozedUntil" IS NULL OR "snoozedUntil" <= NOW())`,
  ];
  const params: any[] = [];
  if (execId) { where.push(`"assigneeExecId" = $1`); params.push(execId); }
  return query<TaskRow>(
    `SELECT * FROM "Task" WHERE ${where.join(' AND ')} ORDER BY "dueAt" ASC NULLS LAST LIMIT 500`,
    params
  );
}
