// ============================================================
// /api/tasks/[id] — update / complete / snooze / delete a task.
// ============================================================
// PATCH body: any of { status, title, details, priority, dueAt, remindAt,
//   assigneeExecId, assigneeName }. status='done' stamps doneAt/doneBy;
//   a snoozedUntil moves the reminder forward.
// DELETE — hard-delete (owner/admin only).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { completeTask, snoozeTask, type TaskRow } from '@/lib/tasks';

const PatchBody = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'snoozed', 'cancelled']).optional(),
  title: z.string().min(1).max(300).optional(),
  details: z.string().max(4000).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueAt: z.string().optional().nullable(),
  remindAt: z.string().optional().nullable(),
  snoozedUntil: z.string().optional().nullable(),
  assigneeExecId: z.string().max(60).optional().nullable(),
  assigneeName: z.string().max(120).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'tasks')) return;

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const existing = await queryOne<TaskRow>(`SELECT * FROM "Task" WHERE id = $1`, [id]);
  if (!existing) return res.status(404).json({ ok: false, error: 'Task not found' });

  // Ownership gate. The Tasks view is universal, so without this any employee
  // could PATCH ANY task by id — reassign it, rename it, mark someone else's
  // done. A task is yours to touch only if you're its assignee or its creator;
  // owner/admin oversee everything. (DELETE has its own stricter owner/admin
  // gate below; this guards the PATCH path.)
  const isManager = user.role === 'owner' || user.role === 'admin';
  const ownsTask = existing.assigneeExecId === user.execId || existing.createdBy === user.execId;
  if (!isManager && !ownsTask) {
    return res.status(403).json({ ok: false, error: 'You can only change tasks assigned to you or that you created.' });
  }

  if (req.method === 'PATCH') {
    if (!requireViewEdit(user, res, 'tasks')) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
    const b = parsed.data;

    // Fast paths for the two most common actions.
    if (b.status === 'done') {
      await completeTask(id, user.execId);
      audit(req, user, 'TASK_DONE', id, { title: existing.title });
      return res.json({ ok: true });
    }
    if (b.status === 'snoozed' && b.snoozedUntil) {
      await snoozeTask(id, b.snoozedUntil);
      audit(req, user, 'TASK_SNOOZE', id, { until: b.snoozedUntil });
      return res.json({ ok: true });
    }

    // General field update — build a dynamic SET list.
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const put = (col: string, val: any) => { sets.push(`"${col}" = $${i++}`); params.push(val); };
    if (b.status !== undefined) put('status', b.status);
    if (b.title !== undefined) put('title', b.title);
    if (b.details !== undefined) put('details', b.details);
    if (b.priority !== undefined) put('priority', b.priority);
    if (b.dueAt !== undefined) put('dueAt', b.dueAt);
    if (b.remindAt !== undefined) put('remindAt', b.remindAt);
    if (b.assigneeExecId !== undefined) put('assigneeExecId', b.assigneeExecId);
    if (b.assigneeName !== undefined) put('assigneeName', b.assigneeName);
    if (sets.length === 0) return res.json({ ok: true });
    sets.push(`"updatedAt" = NOW()`);
    params.push(id);
    await query(`UPDATE "Task" SET ${sets.join(', ')} WHERE id = $${i}`, params);
    audit(req, user, 'TASK_UPDATE', id, { fields: Object.keys(b) });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete tasks' });
    }
    await query(`DELETE FROM "Task" WHERE id = $1`, [id]);
    audit(req, user, 'TASK_DELETE', id, { title: existing.title });
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
