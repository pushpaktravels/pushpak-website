// ============================================================
// lib/visa.ts — visa-desk helpers that tie into the shared Task engine.
// ============================================================
// The visa desk's one bit of automation: an appointment date should
// surface as a reminder in the owning agent's Tasks inbox. Rather than a
// per-department reminder table, we drive the universal Task engine
// (lib/tasks) so the appointment shows up alongside hold-clocks, travel
// reminders and follow-ups, and the dashboard "Due today" widget + the
// reminder cron pick it up for free.
//
//   relatedType = 'visa', relatedId = <application id>
//   kind        = 'visa_appointment'
//
// syncAppointmentTask is idempotent (upsertSystemTask): re-saving an
// application moves the existing open task instead of duplicating, and a
// cleared date / terminal stage cancels it.
// ============================================================
import { upsertSystemTask, cancelOpenTasksFor } from './tasks';

export const VISA_STAGES = [
  'enquiry', 'documentation', 'appointment', 'submitted',
  'processing', 'approved', 'rejected', 'delivered',
] as const;
export type VisaStage = typeof VISA_STAGES[number];

// Stages where the case is closed — no appointment reminder should linger.
export const VISA_TERMINAL_STAGES = new Set<string>(['approved', 'rejected', 'delivered']);

export type VisaAppForTask = {
  id: string;
  applicantName: string;
  country: string;
  stage: string;
  appointmentAt: Date | string | null;
  assigneeExecId: string | null;
  assigneeName: string | null;
};

// Keep the appointment reminder Task in lock-step with the application.
// Call after every create/update. No-op-safe to call repeatedly.
export async function syncAppointmentTask(app: VisaAppForTask): Promise<void> {
  const hasAppt = !!app.appointmentAt;
  const closed = VISA_TERMINAL_STAGES.has(app.stage);

  if (!hasAppt || closed) {
    // Nothing to remind about (no date, or the case is decided/delivered).
    await cancelOpenTasksFor('visa', app.id);
    return;
  }

  await upsertSystemTask(
    { kind: 'visa_appointment', relatedType: 'visa', relatedId: app.id },
    {
      title: `Visa appointment — ${app.applicantName} (${app.country})`,
      details: 'Embassy / VFS appointment is due. Confirm documents and accompany the applicant.',
      department: 'visa',
      priority: 'high',
      dueAt: app.appointmentAt,
      assigneeExecId: app.assigneeExecId,
      assigneeName: app.assigneeName,
      relatedLabel: `${app.applicantName} · ${app.country}`,
    },
  );
}
