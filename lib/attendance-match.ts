// ============================================================
// attendance-match.ts — fuzzy name matching for code mapping.
// ============================================================
// Biometric names are inconsistent ("Deep talukdar" vs "Deep Talukdar",
// "Raunak" vs "Raunak Sureka"). We never auto-commit a mapping — these
// scores only rank PROPOSALS the owner reviews.
// ============================================================

export function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')   // drop punctuation
    .replace(/\b(mr|mrs|ms|md|dr)\b/g, ' ') // honorifics
    .replace(/\s+/g, ' ')
    .trim();
}

// 1.0 = exact; partial credit for token overlap (handles missing
// surnames, reordered tokens). Returns 0..1.
export function nameMatchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;

  // One name is a subset of the other (e.g. "raunak" ⊂ "raunak sureka").
  const smaller = Math.min(ta.size, tb.size);
  const larger = Math.max(ta.size, tb.size);
  if (shared === smaller) {
    // full containment — strong but not perfect if extra tokens exist
    return smaller === larger ? 1 : 0.85;
  }
  // Jaccard-ish overlap otherwise.
  const union = ta.size + tb.size - shared;
  return shared / union;
}
