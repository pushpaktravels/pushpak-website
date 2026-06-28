// ============================================================
// lib/views.ts — canonical map of portal "views" → which roles
// see them by default, plus the server-side access gate.
// ============================================================
// This is the SINGLE source of truth for view-level access. It is
// imported by:
//   • pages/portal/users-auth.tsx  — to render the per-user grid
//   • every confidential API route — via requireView() / canAccessView()
//
// Access rule (mirrors components/Sidebar.tsx canSee EXACTLY so the
// nav, the Users & Authorities grid, and the API can never disagree):
//   • dashboard / profile           → always allowed (personal dept)
//   • owner                          → sees everything
//   • user has a viewPerms list set  → that list is AUTHORITATIVE: it
//                                       fully REPLACES the role defaults,
//                                       so the owner can both widen (e.g.
//                                       Rita, a Domestic Reservations user,
//                                       gets the Followup views) AND narrow
//                                       (restrict an accounts user to just
//                                       a couple of views) a user's access.
//   • no viewPerms                   → fall back to the view's roles[]
//   • otherwise                      → denied (403 from requireView)
//
// IMPORTANT: viewPerms is REPLACE, not additive. An earlier draft OR-ed
// role defaults with viewPerms, which silently ignored any narrowing the
// owner set in the grid — the API would still serve views the Sidebar had
// hidden. Keep this in lock-step with Sidebar.canSee().
//
// IMPORTANT: before the role taxonomy grew from 5 → 12 roles, every
// logged-in user was an accounts person, so most data routes only
// called requireAuth. Now that peons / drivers / visa / packages staff
// have logins too, EVERY confidential route must gate on a view here,
// or those users could read clients' financials & PII.
// ============================================================
import type { NextApiResponse } from 'next';
import { ROLE_SLUGS, INSIGHTS_ONLY_EXEC_IDS } from './roles';
import { roleHasDefaultView } from './roledefaults';

// `group` = the department / module this view belongs to. It is
// PRESENTATION-ONLY: it has no effect on access (canAccessView never reads
// it). It exists so the Users & Authorities permission grid can bucket the
// per-user toggles under a department sub-heading instead of one long flat
// list. Every view must carry one; the heading order lives in VIEW_GROUPS.
export type ViewRow = { key: string; label: string; roles: string[]; group: string };

// Views an "insights-only" identity (e.g. Vishal) may reach. The Command
// Center IS the firm overview — financials + workforce + attendance +
// per-department / per-employee performance, all in one page — so that
// single view satisfies "log in to see the overview of the firm". Keep
// this in lock-step with components/Sidebar.tsx (it imports this set).
export const INSIGHTS_ONLY_VIEWS = new Set<string>(['overview']);

export const VIEWS: ViewRow[] = [
  // Personal — every role, every user (also bypassed in the Sidebar).
  { key: 'dashboard',           label: 'Dashboard',           group: 'Personal',              roles: [...ROLE_SLUGS] },
  { key: 'profile',             label: 'My Profile',          group: 'Personal',              roles: [...ROLE_SLUGS] },
  // Internal chat — universal like the personal views (forced-allowed in
  // canAccessView below), so it is never blocked by a narrow viewPerms list.
  // The insights-only executive (Vishal) is the sole exception.
  { key: 'messages',            label: 'Messages',            group: 'Personal',              roles: [...ROLE_SLUGS] },
  // Tasks is a personal inbox (universal, like Messages).
  { key: 'tasks',               label: 'Tasks',               group: 'Personal',              roles: [...ROLE_SLUGS] },
  // Command Center — the owner's company-wide executive overview
  // (financials + workforce + attendance + team performance). Owners
  // only by default; grantable to others via viewPerms.
  { key: 'overview',            label: 'Command Center',      group: 'Command Center',        roles: ['owner'] },
  // Followup / Accounts module.
  { key: 'followup-dashboard',  label: 'Followup Dashboard',  group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'] },
  { key: 'worklist',            label: 'My Worklist',         group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'team-worklist',       label: 'Team Worklist',       group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts'] },
  { key: 'hold-check',          label: 'Hold Check',          group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'families',            label: 'Clients & Families',  group: 'Accounts & Followup',   roles: ['owner', 'admin'] },
  { key: 'promises',            label: 'Promise Ledger',      group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'payment-plans',       label: 'Doubtful Ledger',     group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'legal',               label: 'Legal Ledger',        group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'] },
  { key: 'collections',         label: 'Collection List',     group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'] },
  { key: 'upload',              label: 'Upload & Refresh',    group: 'Accounts & Followup',   roles: ['owner', 'admin'] },
  { key: 'performance',         label: 'Performance',         group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'scoreboard',          label: 'Scoreboard',          group: 'Accounts & Followup',   roles: ['owner', 'admin', 'cm-accounts'] },
  { key: 'insights',            label: 'Insights',            group: 'Accounts & Followup',   roles: ['owner', 'insights'] },
  // Domestic Reservations module — booking workspace for the
  // domestic-reservations department. Owner/admin oversee; the desk
  // staff get these by default. Stand-alone (no Account link yet).
  { key: 'reservations',          label: 'Reservations',        group: 'Domestic Reservations', roles: ['owner', 'admin', 'domestic-reservations'] },
  { key: 'reservations-dues',     label: 'Reservation Dues',    group: 'Domestic Reservations', roles: ['owner', 'admin', 'domestic-reservations'] },
  { key: 'reservations-worklist', label: 'Reservation Worklist',group: 'Domestic Reservations', roles: ['owner', 'admin', 'domestic-reservations'] },
  // Cross-department performance (Phase 3) — booking-desk leaderboard.
  // Owner/admin oversee; grant a desk lead via viewPerms to let them see it.
  { key: 'reservations-performance', label: 'Desk Performance',  group: 'Domestic Reservations', roles: ['owner', 'admin'] },
  // Upcoming departments — placeholder workspaces (under construction).
  // The role + route + sidebar home are wired now so staff in these
  // departments land somewhere real; the modules get built in later phases.
  { key: 'domestic-package',       label: 'Domestic Package',      group: 'Packages & Visa',    roles: ['owner', 'admin', 'domestic-package'] },
  { key: 'international-packages',  label: 'International Packages', group: 'Packages & Visa',    roles: ['owner', 'admin', 'international-packages'] },
  { key: 'visa',                   label: 'Visa',                  group: 'Packages & Visa',    roles: ['owner', 'admin', 'visa'] },
  // Marketing & Leads — campaigns + the shared sales pipeline (leads is
  // used by Marketing and the booking/visa/package desks).
  { key: 'marketing',              label: 'Marketing',             group: 'Marketing & Leads',  roles: ['owner', 'admin', 'marketing'] },
  { key: 'leads',                  label: 'Leads',                 group: 'Marketing & Leads',  roles: ['owner', 'admin', 'marketing', 'domestic-reservations', 'domestic-package', 'international-packages', 'visa'] },
  // FinBook accounting integration — live ledger / credit-limit lookup and
  // (later) the sync/reconciliation console. Accounts staff + oversight.
  { key: 'finbook',             label: 'FinBook',             group: 'Bookkeeping (FinBook)', roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  // Credit-card booking log — replaces the OTP Google Form + Excel. An
  // accounts screen: the unbilled queue + the full card-spend log. (Bookers
  // will log card payments from inside the booking flow in a later step.)
  // Portal-only; no FinBook. Grant a desk via viewPerms if they adopt it.
  { key: 'card-log',            label: 'Card Bookings',       group: 'Bookkeeping (FinBook)', roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  // Vendor-payment requests — replaces the vendor Google Form + Excel. An
  // accounts/ops screen: raise a request → manager approves → pay → bill.
  // Portal-only; no FinBook. Approving is manager-gated server-side.
  { key: 'vendor-pay',          label: 'Vendor Payments',     group: 'Bookkeeping (FinBook)', roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  // Vendor master admin — the one searchable supplier list behind every vendor
  // picker (bookings, vendor payments). Search/add/edit/deactivate. Portal-only.
  { key: 'vendors',             label: 'Vendors',             group: 'Bookkeeping (FinBook)', roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  // Reconciliation status board — replaces the bank-reco + airline-reco
  // Excels. Mark each account reconciled for its period; managers add the
  // accounts. Portal-only; no FinBook.
  { key: 'reco',                label: 'Reconciliation',      group: 'Bookkeeping (FinBook)', roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  // Auto-billing console (Phase 3) — turn a ticketed booking into a FinBook
  // sales bill. Dry-run by default (simulated, nothing posted); the FinBook
  // chokepoint enforces the mode. Accounts + oversight.
  { key: 'billing',             label: 'Billing',             group: 'Bookkeeping (FinBook)', roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  // Forms/Queries module — replaces the loose Google Forms (Courier, Petrol…).
  // 'query-fill' is broad: anyone may file a query (the form's own fillRoles
  // narrow it further). 'queries' is the accounts response desk where they
  // classify + (dry-run) push. Owner edits the form registry from there.
  { key: 'query-fill',          label: 'Fill a Query',        group: 'Forms & Queries',       roles: [...ROLE_SLUGS] },
  { key: 'queries',             label: 'Queries',             group: 'Forms & Queries',       roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  // HR module.
  { key: 'attendance',          label: 'Attendance',          group: 'HR & Payroll',          roles: ['owner', 'admin', 'hr'] },
  { key: 'employees',           label: 'Employees',           group: 'HR & Payroll',          roles: ['owner', 'admin', 'hr'] },
  { key: 'payroll',             label: 'Payroll',             group: 'HR & Payroll',          roles: ['owner', 'admin', 'hr'] },
  { key: 'overtime',            label: 'Overtime',            group: 'HR & Payroll',          roles: ['owner', 'admin', 'hr'] },
  { key: 'offsite',             label: 'Offsite Attendance',  group: 'HR & Payroll',          roles: ['owner', 'admin', 'hr'] },
  // HR records leave on behalf of staff who can't file it themselves
  // (support / field people). Same engine as self-service 'leave'.
  { key: 'leave-admin',         label: 'Record Leave',        group: 'HR & Payroll',          roles: ['owner', 'admin', 'hr'] },
  // Governance / settings.
  { key: 'users-auth',          label: 'Users & Authorities', group: 'Governance & Settings', roles: ['owner'] },
  { key: 'bulk-cm',             label: 'Bulk CM Assignment',  group: 'Governance & Settings', roles: ['owner', 'admin'] },
  { key: 'audit',               label: 'Audit Log',           group: 'Governance & Settings', roles: ['owner'] },
  { key: 'activity',            label: 'Activity & Time',     group: 'Governance & Settings', roles: ['owner', 'admin'] },
  { key: 'settings',            label: 'Settings',            group: 'Governance & Settings', roles: ['owner', 'admin'] },
];

// Department / module groups, in the order they appear as sub-headings in
// the Users & Authorities permission grid. lib/views.ts owns this order so
// the grid (and any other grouped surface) stays consistent. This is
// PRESENTATION-ONLY — it has no bearing on access; it only organises the
// per-user toggles so each department's permissions sit under one heading.
export const VIEW_GROUPS: string[] = [
  'Personal',
  'Command Center',
  'Accounts & Followup',
  'Domestic Reservations',
  'Packages & Visa',
  'Marketing & Leads',
  'Bookkeeping (FinBook)',
  'Forms & Queries',
  'HR & Payroll',
  'Governance & Settings',
];

export const VIEW_KEYS = VIEWS.map(v => v.key);

const VIEW_BY_KEY = new Map(VIEWS.map(v => [v.key, v]));

// Minimal shape so callers can pass an AuthedUser, a User row, or a
// plain object without coupling this module to Prisma types.
type ViewUser = { execId?: string | null; role: string; viewPerms?: string[] | null; viewReadOnly?: string[] | null };

export function canAccessView(user: ViewUser, key: string): boolean {
  if (!user) return false;
  // Insights-only identities (e.g. Vishal) are pinned to a fixed whitelist
  // and NEVER get the owner bypass below — even if their row says 'owner'.
  if (user.execId && INSIGHTS_ONLY_EXEC_IDS.has(user.execId)) {
    if (key === 'dashboard' || key === 'profile') return true;  // personal
    return INSIGHTS_ONLY_VIEWS.has(key);             // 'messages' → false for Vishal
  }
  if (user.role === 'owner') return true;            // root of trust
  const v = VIEW_BY_KEY.get(key);
  if (!v) return false;                              // unknown view → deny
  // Personal views + chat are never gated — every employee always has them
  // (the insights-only exception is handled above, before this point).
  if (key === 'dashboard' || key === 'profile' || key === 'messages') return true;
  // An explicit viewPerms list is authoritative and REPLACES the role
  // defaults (mirrors Sidebar.canSee) so owners can widen AND narrow.
  if (user.viewPerms && user.viewPerms.length > 0) {
    return user.viewPerms.includes(key);
  }
  // No per-user override → the role's default views decide. These are
  // owner-editable & live (lib/roledefaults.ts), warmed each request by
  // requireAuth; they fall back to this view's hard-coded roles[] if the
  // cache is cold or the DB read failed, so access never breaks.
  return roleHasDefaultView(user.role, key);
}

// Drop-in API gate: returns true if allowed, else sends 403 and returns
// false. Use exactly like requireRole():
//   if (!requireView(user, res, 'worklist')) return;
export function requireView(
  user: ViewUser,
  res: NextApiResponse,
  key: string,
): boolean {
  if (canAccessView(user, key)) return true;
  res.status(403).json({ ok: false, error: 'Not allowed for your role' });
  return false;
}

// Can this user MUTATE within a view, or only look? "View-only" is the
// finer half of access control: the owner can grant a user sight of a
// sheet (viewPerms) while forbidding edits (viewReadOnly). Read-only is
// per-user — it has no role default — so it only ever NARROWS access.
export function canEditView(user: ViewUser, key: string): boolean {
  if (!user) return false;
  // Insights-only identities (e.g. Vishal) are pure spectators: they may
  // edit only their own personal pages, never any data view.
  if (user.execId && INSIGHTS_ONLY_EXEC_IDS.has(user.execId)) {
    return key === 'dashboard' || key === 'profile';
  }
  if (user.role === 'owner') return true;            // root of trust
  if (!canAccessView(user, key)) return false;       // can't see → can't edit
  // Personal views + chat are always editable (sending a message) by the user.
  if (key === 'dashboard' || key === 'profile' || key === 'messages') return true;
  // An explicit per-user read-only flag forbids mutations.
  if (user.viewReadOnly && user.viewReadOnly.includes(key)) return false;
  return true;
}

// Drop-in gate for MUTATING handlers (POST / PATCH / DELETE). Sends 403
// when the caller can see the view but has been marked view-only.
//   if (req.method !== 'GET' && !requireViewEdit(user, res, 'worklist')) return;
export function requireViewEdit(
  user: ViewUser,
  res: NextApiResponse,
  key: string,
): boolean {
  if (canEditView(user, key)) return true;
  res.status(403).json({ ok: false, error: 'View-only: you cannot make changes here' });
  return false;
}
