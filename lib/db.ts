// ============================================================
// Prisma client — singleton.
// ============================================================
// Supabase poolers + Prisma's prepared statement cache is a known
// problem combo. We work around it with TWO URL flags:
//   ?pgbouncer=true     → Prisma stops using server-side prepared statements
//   ?connection_limit=1 → Prisma uses one connection at a time (no pool churn)
// Together they make pgbouncer-fronted Postgres reliably work with Prisma.
// ============================================================
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function tunedUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  let out = url;
  if (!out.includes('pgbouncer=')) {
    out += (out.includes('?') ? '&' : '?') + 'pgbouncer=true';
  }
  if (!out.includes('connection_limit=')) {
    out += '&connection_limit=1';
  }
  return out;
}

// ALWAYS use DATABASE_URL (transaction pooler, port 6543) for app queries.
// DIRECT_URL is for migrations only — Prisma reads it from schema.prisma directly.
// Previously this preferred DIRECT_URL in dev, but session pooler (5432) breaks
// prepared statements. Transaction pooler with pgbouncer=true is the only stable config.
const baseUrl = process.env.DATABASE_URL;

const url = tunedUrl(baseUrl);

// Log the masked URL so we can verify what's being connected to.
if (process.env.NODE_ENV !== 'production' && url) {
  const masked = url.replace(/:([^:@]+)@/, ':***@');
  // eslint-disable-next-line no-console
  console.log('[prisma] connecting to', masked);
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasourceUrl: url,
  });

if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;
