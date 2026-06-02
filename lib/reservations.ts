// ============================================================
// lib/reservations.ts — Domestic Reservations helpers (hold-clock).
// ============================================================
// A "Held" PNR has a ticketing deadline (holdUntil): if it isn't
// ticketed by then the airline releases the seats and the fare can jump.
// That deadline should nag the owning agent. Rather than a per-module
// reminder, we drive the universal Task engine (lib/tasks) so the
// hold-clock shows up in the agent's inbox next to everything else and
// the dashboard "Due today" widget + reminder cron pick it up for free.
//
//   relatedType = 'reservation', relatedId = <reservation id>
//   kind        = 'reservation_hold'
//
// The reminder only exists while status = 'Held' AND holdUntil is set.
// Ticketing, cancelling or clearing the deadline cancels it.
// syncHoldTask is idempotent and no-op-safe to call after every save.
// ============================================================
import { upsertSystemTask, cancelOpenTasksFor } from './tasks';

export type ReservationForTask = {
  id: string;
  passengerName: string;
  sector: string;
  status: string;
  holdUntil: Date | string | null;
  agentExecId: string | null;
  agentName: string | null;
};

// margin = fare − vendor cost. Centralised so the API, list and any
// future desk-performance report all compute it the same way.
export function margin(fareAmount: number | string, costAmount: number | string): number {
  return Number(fareAmount || 0) - Number(costAmount || 0);
}

// Keep the hold-clock reminder Task in lock-step with the booking.
// Call after every create/update. No-op-safe to call repeatedly.
export async function syncHoldTask(r: ReservationForTask): Promise<void> {
  const held = r.status === 'Held' && !!r.holdUntil;
  if (!held) {
    await cancelOpenTasksFor('reservation', r.id);
    return;
  }
  await upsertSystemTask(
    { kind: 'reservation_hold', relatedType: 'reservation', relatedId: r.id },
    {
      title: `Hold expiring — ${r.passengerName} (${r.sector})`,
      details: 'This PNR is on hold. Ticket it or release the seats before the airline auto-cancels and the fare changes.',
      department: 'domestic-reservations',
      priority: 'urgent',
      dueAt: r.holdUntil,
      assigneeExecId: r.agentExecId,
      assigneeName: r.agentName,
      relatedLabel: `${r.passengerName} · ${r.sector}`,
    },
  );
}
