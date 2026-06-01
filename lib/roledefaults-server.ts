// ============================================================
// lib/roledefaults-server.ts — server-only loader for role defaults.
// ============================================================
// Reads the Setting table (category 'roledefaults') and populates the
// shared in-process cache in lib/roledefaults.ts via applyRoleDefaults().
// Kept SEPARATE from lib/roledefaults.ts because that file is imported by
// lib/views.ts which the client bundles — importing lib/pg there would
// drag node-postgres ('net'/'tls') into the browser build and break it.
//
// Warmed from requireAuth() once per request (30s cache → usually a
// no-op). If the DB read fails we leave the cache as-is, so the sync gate
// falls back to the hard-coded defaults and access never breaks.
// ============================================================
import { query } from './pg';
import { roleDefaultsFresh, applyRoleDefaults, ROLE_DEFAULTS_CATEGORY } from './roledefaults';

export async function ensureRoleDefaultsLoaded(): Promise<void> {
  if (roleDefaultsFresh()) return;
  try {
    const rows = await query<{ key: string; value: string }>(
      `SELECT key, value FROM "Setting" WHERE category = $1`,
      [ROLE_DEFAULTS_CATEGORY]
    );
    const prefix = `${ROLE_DEFAULTS_CATEGORY}:`;
    const stored: Record<string, string[]> = {};
    for (const row of rows) {
      if (!row.key.startsWith(prefix)) continue;
      const role = row.key.slice(prefix.length);
      try {
        const arr = JSON.parse(row.value);
        if (Array.isArray(arr)) {
          stored[role] = arr.filter((x: any): x is string => typeof x === 'string');
        }
      } catch { /* corrupt row → that role falls back to its hard default */ }
    }
    applyRoleDefaults(stored);
  } catch {
    // DB hiccup: keep whatever we had (or stay cold → hard fallback).
  }
}
