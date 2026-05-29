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
import { ROLE_SLUGS } from './roles';

export type ViewRow = { key: string; label: string; roles: string[] };

export const VIEWS: ViewRow[] = [
  // Personal — every role, every user (also bypassed in the Sidebar).
  { key: 'dashboard',           label: 'Dashboard',           roles: [...ROLE_SLUGS] },
  { key: 'profile',             label: 'My Profile',          roles: [...ROLE_SLUGS] },
  // Followup / Accounts module.
  { key: 'followup-dashboard',  label: 'Followup Dashboard',  roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'] },
  { key: 'worklist',            label: 'My Worklist',         roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'team-worklist',       label: 'Team Worklist',       roles: ['owner', 'admin', 'cm-accounts'] },
  { key: 'hold-check',          label: 'Hold Check',          roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'families',            label: 'Clients & Families',  roles: ['owner', 'admin'] },
  { key: 'promises',            label: 'Promise Ledger',      roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'payment-plans',       label: 'Doubtful Ledger',     roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'legal',               label: 'Legal Ledger',        roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'] },
  { key: 'collections',         label: 'Collection List',     roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'] },
  { key: 'upload',              label: 'Upload & Refresh',    roles: ['owner', 'admin'] },
  { key: 'performance',         label: 'Performance',         roles: ['owner', 'admin', 'cm-accounts', 'accounts'] },
  { key: 'scoreboard',          label: 'Scoreboard',          roles: ['owner', 'admin', 'cm-accounts'] },
  { key: 'insights',            label: 'Insights',            roles: ['owner', 'insights'] },
  // HR module.
  { key: 'attendance',          label: 'Attendance',          roles: ['owner', 'admin', 'hr'] },
  { key: 'employees',           label: 'Employees',           roles: ['owner', 'admin', 'hr'] },
  // Governance / settings.
  { key: 'users-auth',          label: 'Users & Authorities', roles: ['owner'] },
  { key: 'bulk-cm',             label: 'Bulk CM Assignment',  roles: ['owner', 'admin'] },
  { key: 'audit',               label: 'Audit Log',           roles: ['owner'] },
  { key: 'permissions',         label: 'Permissions',         roles: ['owner'] },
  { key: 'activity',            label: 'Activity & Time',     roles: ['owner', 'admin'] },
  { key: 'settings',            label: 'Settings',            roles: ['owner', 'admin'] },
];

export const VIEW_KEYS = VIEWS.map(v => v.key);

const VIEW_BY_KEY = new Map(VIEWS.map(v => [v.key, v]));

// Minimal shape so callers can pass an AuthedUser, a User row, or a
// plain object without coupling this module to Prisma types.
type ViewUser = { role: string; viewPerms?: string[] | null };

export function canAccessView(user: ViewUser, key: string): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;            // root of trust
  const v = VIEW_BY_KEY.get(key);
  if (!v) return false;                              // unknown view → deny
  // Personal views are never gated — every employee always has them.
  if (key === 'dashboard' || key === 'profile') return true;
  // An explicit viewPerms list is authoritative and REPLACES the role
  // defaults (mirrors Sidebar.canSee) so owners can widen AND narrow.
  if (user.viewPerms && user.viewPerms.length > 0) {
    return user.viewPerms.includes(key);
  }
  // No per-user override → the view's default roles decide.
  return v.roles.includes(user.role);
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
