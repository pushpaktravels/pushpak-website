// ============================================================
// lib/roles.ts — canonical role list for the portal.
// ============================================================
// One file controls the dropdown in Users & Authorities, the
// Zod validators on /api/users, and the default role lists on
// every nav item. To add a new role, add it here and decide
// which views (if any) it should see by default.
//
// Access control fallback rules:
//   - owner / admin → always see everything (Sidebar.canSee)
//   - personal dept views (Dashboard, My Profile) → always shown
//   - everyone else → role-default access OR per-user viewPerms
//
// 2026-05-29: replaced the old { owner, admin, cm, exec, analyst }
// enum with department-tagged roles. Existing users migrated:
// cm → cm-accounts, exec → domestic-reservations, analyst → insights.
// ============================================================

export const ROLES = [
  { slug: 'owner',                  label: 'Owner',                 badge: 'Owner' },
  { slug: 'admin',                  label: 'Admin',                 badge: 'Admin' },
  { slug: 'cm-accounts',            label: 'CM — Accounts',         badge: 'CM (Accounts)' },
  { slug: 'accounts',               label: 'Accounts',              badge: 'Accounts' },
  { slug: 'domestic-reservations',  label: 'Domestic Reservations', badge: 'Domestic Res.' },
  { slug: 'domestic-package',       label: 'Domestic Package',      badge: 'Domestic Pkg' },
  { slug: 'international-packages', label: 'International Packages', badge: 'Intl Pkg' },
  { slug: 'visa',                   label: 'Visa',                  badge: 'Visa' },
  { slug: 'insights',               label: 'Insights',              badge: 'Insights' },
  { slug: 'marketing',              label: 'Marketing',             badge: 'Marketing' },
  { slug: 'hr',                     label: 'HR',                    badge: 'HR' },
] as const;

export type RoleSlug = typeof ROLES[number]['slug'];

export const ROLE_SLUGS = ROLES.map(r => r.slug) as RoleSlug[];

// Convenience sets for common access predicates so call-sites stay tidy.
export const OWNER_ADMIN: RoleSlug[]            = ['owner', 'admin'];
export const ACCOUNTS_ALL: RoleSlug[]           = ['owner', 'admin', 'cm-accounts', 'accounts'];
export const ACCOUNTS_MANAGERS: RoleSlug[]      = ['owner', 'admin', 'cm-accounts'];
export const ACCOUNTS_PLUS_INSIGHTS: RoleSlug[] = ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'];

export function roleLabel(slug: string): string {
  return ROLES.find(r => r.slug === slug)?.label || slug;
}
export function roleBadge(slug: string): string {
  return ROLES.find(r => r.slug === slug)?.badge || slug;
}

// Sort order used by /api/users so the table sorts by seniority.
export const ROLE_ORDER: Record<string, number> = Object.fromEntries(
  ROLES.map((r, i) => [r.slug, i])
);
