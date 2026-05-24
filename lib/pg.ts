// ============================================================
// node-postgres pool — THE runtime database client.
// ============================================================
// Replaces Prisma at runtime because Prisma 5.x + Supabase pgbouncer
// has an unresolved prepared-statement collision bug. Even
// $queryRawUnsafe creates server-side prepared statements that
// vanish when pgbouncer recycles the underlying connection.
//
// node-postgres uses *unnamed* queries by default — no server-side
// prepared statements, so pgbouncer transaction mode just works.
//
// Prisma remains in use for:
//   • Schema authoring (prisma/schema.prisma)
//   • Migrations (prisma db push, prisma generate)
//   • TypeScript types (still imported from @prisma/client)
// ============================================================
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Reuse the pool across Next.js HMR reloads in dev so we don't
// leak connections every time a file changes.
export const pool: Pool =
  global.__pgPool ??
  new Pool({
    connectionString,
    max: 5,                         // small pool — Supabase pgbouncer multiplexes anyway
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== 'production') {
  global.__pgPool = pool;
  // Log the masked URL once on first init so we can verify the port.
  if (!global.__pgPool!.options) { /* noop, marker */ }
  const masked = connectionString.replace(/:([^:@]+)@/, ':***@');
  // eslint-disable-next-line no-console
  console.log('[pg] pool connecting to', masked);
}

// ─── Query helpers ──────────────────────────────────────────────
// Use parameterised queries ($1, $2, ...). pg escapes for us.

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// ─── Transaction helper ────────────────────────────────────────
// Wraps a callback in BEGIN/COMMIT, with automatic ROLLBACK on
// throw. The callback receives a `q` helper bound to the txn's
// dedicated client so all writes land on the same connection.
//
// Usage:
//   await withTransaction(async (q) => {
//     await q('UPDATE "Account" SET ... WHERE id = $1', [id]);
//     await q('INSERT INTO "AccountHistory" ...', [...]);
//   });
export async function withTransaction<T>(
  fn: (q: (sql: string, params?: any[]) => Promise<any[]>) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(async (sql, params = []) => {
      const r = await client.query(sql, params);
      return r.rows;
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Convenience: cuid-ish id generator for new rows.
// Prisma generates cuids when going through its client; pg insertions
// need an explicit id. This isn't a true cuid but is collision-safe
// for our scale (sub-millisecond seed + random suffix).
export function newId(prefix: string = 'rec'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
