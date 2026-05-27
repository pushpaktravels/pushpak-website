// ============================================================
// upload-diff.ts — diff parsed FinBook rows vs current Account snapshot.
// ============================================================
// Pure logic (no DB writes). Given:
//   - parsed: ParsedAccount[] from upload-parser
//   - current: minimal Account snapshot fetched by the caller
//   - openPromises: open promises (for "promise kept" detection)
// Returns a structured plan describing exactly what would change.
//
// The caller (commit endpoint) replays the plan inside a single
// withTransaction so the whole refresh is atomic.
// ============================================================
import type { ParsedAccount } from './upload-parser';

export type CurrentAccount = {
  party: string;
  bill: number;
  d30: number; d60: number; d90: number; d90p: number;
  exec: string | null;
  cm: string | null;
  family: string | null;
  branch: string | null;
  tier: string;
  tierOverride: string | null;
  alert: string | null;
  alertOverride: string | null;
  creditLimit: number;
  creditPeriod: string | null;
};

export type OpenPromise = {
  id: string;
  party: string;
  outstandingAt: number;
};

export type DiffPlan = {
  // Per-account decisions
  toCreate: ParsedAccount[];
  toUpdate: Array<{
    party: string;
    before: CurrentAccount;
    after:  Pick<ParsedAccount, 'bill'|'d30'|'d60'|'d90'|'d90p'|'exec'|'cm'|'family'|'branch'|'creditLimit'|'creditPeriod'>;
    changes: string[]; // human-readable list e.g. ["Outstanding ₹1.2L → ₹0.9L", "Exec VISHAL → VANSHIKA"]
  }>;
  toClose: Array<{ party: string; before: CurrentAccount }>; // present in DB, missing from file, bill > 0
  // Side-effects
  collections: Array<{
    party: string;
    prevOutstanding: number;
    newOutstanding: number;
    amount: number;
    exec: string | null;
    cm: string | null;
    family: string | null;
  }>;
  promisesKept: Array<{ promiseId: string; party: string; outstandingNow: number }>;
  // New onHold candidates (outstanding > limit, or >90+ bucket has weight)
  newHoldCandidates: Array<{ party: string; outstanding: number; reason: string }>;
  // Auto-computed tier suggestions (only applied if no tierOverride)
  tierSuggestions: Array<{ party: string; from: string; to: string }>;
  // Summary numbers
  summary: {
    fileRows: number;
    currentAccounts: number;
    finalAccounts: number;
    totalOutstanding: number;
    prevTotalOutstanding: number;
    delta: number;
    createCount: number;
    updateCount: number;
    closeCount: number;
    collectionCount: number;
    collectionAmount: number;
    holdCount: number;
    promisesKeptCount: number;
  };
};

// Tier rule: outstanding × age weight → A-E
// (Keeps the existing scale Vanshika set in v2.)
function computeTier(bill: number, d30: number, d60: number, d90: number, d90p: number): string {
  if (bill <= 0) return 'A';
  // If most of the outstanding is in 90+, jump straight to D/E
  const ratio90p = d90p / Math.max(bill, 1);
  const ratio90  = (d90 + d90p) / Math.max(bill, 1);
  if (ratio90p > 0.5 || d90p > 200000) return 'E';
  if (ratio90  > 0.5 || d90 + d90p > 100000) return 'D';
  if (d60 > 50000 || (d60 + d90 + d90p) / Math.max(bill, 1) > 0.4) return 'C';
  if (d30 > bill * 0.6) return 'A';
  return 'B';
}

const FMT = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export function buildDiffPlan(
  parsed: ParsedAccount[],
  current: CurrentAccount[],
  openPromises: OpenPromise[],
  opts: { holdLimitMultiplier?: number; holdOver90Plus?: number } = {}
): DiffPlan {
  const holdMult  = opts.holdLimitMultiplier ?? 1;
  const hold90p   = opts.holdOver90Plus      ?? 50000;

  const byParty = new Map<string, CurrentAccount>();
  current.forEach(c => byParty.set(c.party.toUpperCase(), c));

  const toCreate: ParsedAccount[] = [];
  const toUpdate: DiffPlan['toUpdate'] = [];
  const collections: DiffPlan['collections'] = [];
  const newHoldCandidates: DiffPlan['newHoldCandidates'] = [];
  const tierSuggestions: DiffPlan['tierSuggestions'] = [];

  const seenInFile = new Set<string>();
  let totalOutstanding = 0;

  for (const p of parsed) {
    const key = p.party.toUpperCase();
    seenInFile.add(key);
    totalOutstanding += p.bill;

    const cur = byParty.get(key);
    if (!cur) {
      toCreate.push(p);
      // Hold flag on new accounts with bad age profile
      if (p.d90p > hold90p) {
        newHoldCandidates.push({
          party: p.party, outstanding: p.bill,
          reason: `New account with ${FMT(p.d90p)} in 90+ bucket`,
        });
      }
      // Tier suggestion (always — new account)
      const suggested = computeTier(p.bill, p.d30, p.d60, p.d90, p.d90p);
      // No tier override on new accounts, so this is the initial tier
      // (we surface it but creation will just use this directly).
      tierSuggestions.push({ party: p.party, from: '—', to: suggested });
      continue;
    }

    // Existing — diff
    const changes: string[] = [];
    if (Math.abs(p.bill - cur.bill) > 0.5)             changes.push(`Outstanding ${FMT(cur.bill)} → ${FMT(p.bill)}`);
    if (Math.abs(p.d30 - cur.d30) > 0.5)               changes.push(`0-30: ${FMT(cur.d30)} → ${FMT(p.d30)}`);
    if (Math.abs(p.d60 - cur.d60) > 0.5)               changes.push(`31-60: ${FMT(cur.d60)} → ${FMT(p.d60)}`);
    if (Math.abs(p.d90 - cur.d90) > 0.5)               changes.push(`61-90: ${FMT(cur.d90)} → ${FMT(p.d90)}`);
    if (Math.abs(p.d90p - cur.d90p) > 0.5)             changes.push(`90+: ${FMT(cur.d90p)} → ${FMT(p.d90p)}`);
    if (p.exec   && p.exec   !== cur.exec)             changes.push(`Exec ${cur.exec ?? '—'} → ${p.exec}`);
    if (p.cm     && p.cm     !== cur.cm)               changes.push(`CM ${cur.cm ?? '—'} → ${p.cm}`);
    if (p.family && p.family !== cur.family)           changes.push(`Family ${cur.family ?? '—'} → ${p.family}`);
    if (p.branch && p.branch !== cur.branch)           changes.push(`Branch ${cur.branch ?? '—'} → ${p.branch}`);
    if (p.creditLimit && Math.abs(p.creditLimit - cur.creditLimit) > 0.5) {
      changes.push(`Credit limit ${FMT(cur.creditLimit)} → ${FMT(p.creditLimit)}`);
    }

    if (changes.length > 0) {
      toUpdate.push({
        party: cur.party,
        before: cur,
        after: {
          bill: p.bill, d30: p.d30, d60: p.d60, d90: p.d90, d90p: p.d90p,
          exec: p.exec, cm: p.cm, family: p.family, branch: p.branch,
          creditLimit: p.creditLimit, creditPeriod: p.creditPeriod,
        },
        changes,
      });
    }

    // Collection detection: outstanding strictly decreased.
    if (p.bill < cur.bill - 0.5) {
      collections.push({
        party: cur.party,
        prevOutstanding: cur.bill,
        newOutstanding: p.bill,
        amount: cur.bill - p.bill,
        exec: p.exec ?? cur.exec,
        cm:   p.cm   ?? cur.cm,
        family: p.family ?? cur.family,
      });
    }

    // Hold candidate detection
    const limit = p.creditLimit || cur.creditLimit;
    if (limit > 0 && p.bill > limit * holdMult && cur.alert !== 'On Hold') {
      newHoldCandidates.push({
        party: cur.party, outstanding: p.bill,
        reason: `Outstanding ${FMT(p.bill)} exceeds credit limit ${FMT(limit)}`,
      });
    } else if (p.d90p > hold90p && cur.alert !== 'On Hold') {
      newHoldCandidates.push({
        party: cur.party, outstanding: p.bill,
        reason: `${FMT(p.d90p)} stuck in 90+ bucket`,
      });
    }

    // Tier suggestion (only when no override)
    if (!cur.tierOverride) {
      const suggested = computeTier(p.bill, p.d30, p.d60, p.d90, p.d90p);
      if (suggested !== cur.tier) {
        tierSuggestions.push({ party: cur.party, from: cur.tier, to: suggested });
      }
    }
  }

  // Closures: in DB, not in file. We don't delete — we set bill to 0
  // and stamp lastTouched. (Deletion would lose history. Keep the row.)
  const toClose: DiffPlan['toClose'] = [];
  for (const cur of current) {
    if (seenInFile.has(cur.party.toUpperCase())) continue;
    if (cur.bill <= 0) continue; // Already zero, nothing to do
    toClose.push({ party: cur.party, before: cur });
    // Also a collection event — the bill went to zero
    collections.push({
      party: cur.party,
      prevOutstanding: cur.bill,
      newOutstanding: 0,
      amount: cur.bill,
      exec: cur.exec,
      cm:   cur.cm,
      family: cur.family,
    });
  }

  // Promises kept: any open promise whose party's new outstanding
  // is <= the outstanding at the time the promise was logged minus
  // a tolerance. Simplest definition: outstanding has dropped at all.
  const finalByParty = new Map<string, number>();
  for (const p of parsed) finalByParty.set(p.party.toUpperCase(), p.bill);
  for (const cur of current) {
    if (!finalByParty.has(cur.party.toUpperCase())) finalByParty.set(cur.party.toUpperCase(), 0);
  }
  const promisesKept: DiffPlan['promisesKept'] = [];
  for (const prom of openPromises) {
    const newBill = finalByParty.get(prom.party.toUpperCase());
    if (newBill === undefined) continue;
    if (newBill < prom.outstandingAt - 0.5) {
      promisesKept.push({ promiseId: prom.id, party: prom.party, outstandingNow: newBill });
    }
  }

  const prevTotalOutstanding = current.reduce((s, c) => s + Number(c.bill), 0);
  const collectionAmount = collections.reduce((s, c) => s + c.amount, 0);

  return {
    toCreate, toUpdate, toClose,
    collections, promisesKept, newHoldCandidates, tierSuggestions,
    summary: {
      fileRows: parsed.length,
      currentAccounts: current.length,
      finalAccounts: current.length + toCreate.length,
      totalOutstanding,
      prevTotalOutstanding,
      delta: totalOutstanding - prevTotalOutstanding,
      createCount: toCreate.length,
      updateCount: toUpdate.length,
      closeCount: toClose.length,
      collectionCount: collections.length,
      collectionAmount,
      holdCount: newHoldCandidates.length,
      promisesKeptCount: promisesKept.length,
    },
  };
}
