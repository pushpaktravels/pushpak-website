// ============================================================
// Rate limiter — simple in-memory token bucket per IP+key.
// ============================================================
// For prod scale this should move to Redis (Upstash has a free tier).
// For now: lives in process memory; resets on Vercel cold start
// (which is acceptable — an attacker still can't bypass the 5-attempt
// lockout on the User record, which IS persisted).
// ============================================================
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetIn: windowMs };
  }
  existing.count++;
  if (existing.count > limit) {
    return { ok: false, remaining: 0, resetIn: existing.resetAt - now };
  }
  return { ok: true, remaining: limit - existing.count, resetIn: existing.resetAt - now };
}

// Sweep stale buckets periodically (memory hygiene)
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets.entries()) if (b.resetAt < now) buckets.delete(k);
}, 60_000).unref?.();
