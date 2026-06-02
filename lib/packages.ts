// ============================================================
// lib/packages.ts — package-desk helpers that tie into the Task engine.
// ============================================================
// Shared by both package departments. The desk's automation: a confirmed
// trip with a departure date should nudge the agent to prep & send
// vouchers in time. Rather than a per-department reminder, we drive the
// universal Task engine (lib/tasks) so it lands in the agent's inbox
// alongside everything else and the dashboard widget / cron pick it up.
//
//   relatedType = 'package', relatedId = <package id>
//   kind        = 'package_voucher'
//
// The reminder fires VOUCHER_LEAD_DAYS before departure (or now, if the
// trip is closer than that). syncPackageTasks is idempotent and
// no-op-safe to call after every create/update.
// ============================================================
import { upsertSystemTask, cancelOpenTasksFor } from './tasks';

export const PACKAGE_DEPARTMENTS = ['domestic-package', 'international-packages'] as const;
export type PackageDepartment = typeof PACKAGE_DEPARTMENTS[number];

export const PACKAGE_STAGES = [
  'enquiry', 'quoted', 'confirmed', 'vouchers_sent',
  'travelling', 'completed', 'cancelled',
] as const;
export type PackageStage = typeof PACKAGE_STAGES[number];

// Stages where no voucher reminder is wanted: enquiry/quoted (not booked
// yet — chase via Lead/follow-up instead), or completed/cancelled (done).
const NO_REMINDER_STAGES = new Set<string>(['enquiry', 'quoted', 'completed', 'cancelled']);

const VOUCHER_LEAD_DAYS = 5;

export type PackageForTask = {
  id: string;
  title: string;
  department: string;
  stage: string;
  travelStart: Date | string | null;
  assigneeExecId: string | null;
  assigneeName: string | null;
};

// Keep the voucher-prep reminder Task in lock-step with the package.
// Call after every create/update. No-op-safe to call repeatedly.
export async function syncPackageTasks(pkg: PackageForTask): Promise<void> {
  const start = pkg.travelStart ? new Date(pkg.travelStart) : null;
  const active = start && !isNaN(start.getTime()) && !NO_REMINDER_STAGES.has(pkg.stage);

  if (!active || !start) {
    await cancelOpenTasksFor('package', pkg.id);
    return;
  }

  // Remind VOUCHER_LEAD_DAYS before departure, but never in the past.
  const remindAt = new Date(start.getTime() - VOUCHER_LEAD_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  await upsertSystemTask(
    { kind: 'package_voucher', relatedType: 'package', relatedId: pkg.id },
    {
      title: `Send vouchers — ${pkg.title}`,
      details: 'Departure is approaching. Confirm hotels/transport and send the client their vouchers & itinerary.',
      department: pkg.department,
      priority: 'high',
      dueAt: start,
      remindAt: remindAt > now ? remindAt : now,
      assigneeExecId: pkg.assigneeExecId,
      assigneeName: pkg.assigneeName,
      relatedLabel: pkg.title,
    },
  );
}
