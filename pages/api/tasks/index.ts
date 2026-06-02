// ============================================================
// /api/tasks — the shared task / reminder inbox.
// ============================================================
// GET  ?scope=mine|department|all & status= & kind= & relatedType= & relatedId=
//   • mine        → tasks assigned to the caller (default)
//   • department  → all tasks for the caller's department
//   • all         → every task (owner/admin only; others fall back to mine)
// POST → create a task.
//
// Everyone has the 'tasks' view (personal inbox, like Messages). Creating
// is allowed for anyone who can edit the view. Department modules call the
// lib/tasks.ts helpers directly server-side; this route backs the UI.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { createTask, listTasks, type TaskFilter } from '@/lib/tasks';

const CreateBody = z.object({
  kind: z.enum(['reservation_hold', 'travel_reminder', 'visa_appointment', 'package_voucher', 'lead_followup', 'promise', 'generic']).default('generic'),
  title: z.string().min(1).max(300),
  details: z.string().max(4000).optional().nullable(),
  department: z.string().max(60).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueAt: z.string().optional().nullable(),
  remindAt: z.string().optional().nullable(),
  assigneeExecId: z.string().max(60).optional().nullable(),
  assigneeName: z.string().max(120).optional().nullable(),
  relatedType: z.string().max(40).optional().nullable(),
  relatedId: z.string().max(60).optional().nullable(),
  relatedLabel: z.string().max(200).optional().nullable(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'tasks')) return;

  if (req.method === 'GET') {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'mine';
    const f: TaskFilter = {};
    if (typeof req.query.status === 'string') f.status = req.query.status;
    if (typeof req.query.kind === 'string') f.kind = req.query.kind;
    if (typeof req.query.relatedType === 'string') f.relatedType = req.query.relatedType;
    if (typeof req.query.relatedId === 'string') f.relatedId = req.query.relatedId;

    const isManager = user.role === 'owner' || user.role === 'admin';
    if (scope === 'all' && isManager) {
      // no assignee/department scoping
    } else if (scope === 'department' && user.role) {
      f.department = user.role;
    } else {
      f.assigneeExecId = user.execId; // mine (default + fallback for non-managers)
    }

    const tasks = await listTasks(f);
    return res.json({ ok: true, tasks });
  }

  if (req.method === 'POST') {
    if (!requireViewEdit(user, res, 'tasks')) return;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request' });
    const b = parsed.data;
    const task = await createTask({
      ...b,
      // Default the owner to the creator if none supplied.
      assigneeExecId: b.assigneeExecId ?? user.execId,
      assigneeName: b.assigneeName ?? user.name,
      department: b.department ?? (user.role !== 'owner' && user.role !== 'admin' ? user.role : null),
      createdBy: user.execId,
    });
    audit(req, user, 'TASK_CREATE', task.id, { kind: task.kind, title: task.title, assignee: task.assigneeExecId });
    return res.json({ ok: true, task });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
