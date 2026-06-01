// ============================================================
// lib/roledefaults.ts — owner-editable, LIVE default view-access
// for each role. (CLIENT-SAFE: no DB import here.)
// ============================================================
// Before this module, "which views does role X see by default" was
// hard-coded in VIEWS[].roles (lib/views.ts). The owner asked to edit
// those defaults from Users & Authorities and have the change apply to
// everyone on that role immediately. So role defaults now live in the
// "Setting" table (category 'roledefaults', one row per role, key
// `roledefaults:<role>`, value = JSON array of view keys), overlaid on
// the hard-coded VIEWS defaults as a SAFE FALLBACK:
//
//   • A role with NO stored row            → uses the hard-coded default.
//   • A role with a stored row             → that list fully replaces it.
//   • A USER with their own viewPerms      → unaffected (viewPerms still
//     REPLACE role defaults, per lib/views.ts) — i.e. "everyone on the
//     role EXCEPT anyone you've custom-set".
//
// This file is imported by lib/views.ts (which the CLIENT bundles), so it
// must NOT import lib/pg. The actual DB load lives in the server-only
// lib/roledefaults-server.ts, which calls applyRoleDefaults() here to
// populate the shared cache. canAccessView() (sync) reads
// roleHasDefaultView(); if the cache is cold (e.g. on the client, or
// before requireAuth warms it) we fall back to the hard-coded defaults —
// identical to pre-feature behaviour, so access never breaks.
// ============================================================
import { ROLE_SLUGS } from './roles';
import { VIEWS } from './views';

export const ROLE_DEFAULTS_CATEGORY = 'roledefaults';
export const roleDefaultKey = (role: string) => `${ROLE_DEFAULTS_CATEGORY}:${role}`;

// Hard-coded fallback (role -> Set<viewKey>), derived lazily from VIEWS so
// there is no circular-import work at module-eval time.
let _hard: Map<string, Set<string>> | null = null;
function hard(): Map<string, Set<string>> {
  if (_hard) return _hard;
  const m = new Map<string, Set<string>>();
  for (const r of ROLE_SLUGS) m.set(r, new Set());
  for (const v of VIEWS) {
    for (const r of v.roles) {
      if (!m.has(r)) m.set(r, new Set());
      m.get(r)!.add(v.key);
    }
  }
  _hard = m;
  return m;
}

// Effective cache: hard defaults with stored overrides applied per role.
const CACHE_MS = 30_000;
let cache: { at: number; map: Map<string, Set<string>> } | null = null;

export function roleDefaultsFresh(): boolean {
  return !!cache && Date.now() - cache.at < CACHE_MS;
}

// Overlay stored overrides (role -> viewKeys[]) on the hard defaults and
// set the cache. Called by the server loader after reading the Setting
// table, and by the client (Users & Authorities) after fetching defaults
// so the access matrix reflects live data.
export function applyRoleDefaults(stored: Record<string, string[]>): void {
  const eff = new Map<string, Set<string>>();
  for (const role of ROLE_SLUGS) {
    eff.set(role, Object.prototype.hasOwnProperty.call(stored, role)
      ? new Set(stored[role])
      : new Set(hard().get(role) ?? []));
  }
  cache = { at: Date.now(), map: eff };
}

// Sync read used by canAccessView. Falls back to hard-coded defaults when
// the cache hasn't been warmed (safe: identical to old behaviour).
export function roleDefaultViews(role: string): Set<string> {
  const m = cache?.map ?? hard();
  return m.get(role) ?? new Set();
}
export function roleHasDefaultView(role: string, key: string): boolean {
  return roleDefaultViews(role).has(key);
}

// Current effective defaults as plain JSON (for the editor + /api/me).
export function effectiveRoleDefaults(): Record<string, string[]> {
  const m = cache?.map ?? hard();
  const out: Record<string, string[]> = {};
  for (const role of ROLE_SLUGS) out[role] = Array.from(m.get(role) ?? []);
  return out;
}

export function bustRoleDefaultsCache() { cache = null; }
