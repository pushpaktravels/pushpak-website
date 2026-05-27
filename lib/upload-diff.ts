// ============================================================
// upload-diff.ts — diff parsed FinBook rows vs current snapshot.
// ============================================================
// Three builders, one per report type:
//
//   buildAgewisePlan     → primary financial refresh.
//     • Outstanding + 4 aging buckets on every Account.
//     • Detects collections (outstanding dropped).
//     • Marks open Promises Kept (balance fell below promise amount).
//     • Raises Hold candidates (over credit-limit / heavy 90+).
//     • Auto-suggests tier (skips parties with manual tierOverride).
//     • Parties missing from the file → cleared to bill=0.
//
//   buildClientwisePlan  → exec assignment only.
//     • Updates Account.exec for matching parties.
//     • New parties get created with bill = balance (so they at least
//       show up in the portal until the next agewise refresh).
//     • NEVER touches bill on existing parties — that's agewise's job.
//
//   buildFamilywisePlan  → family assignment only.
//     • Updates Account.family for matching parties.
//     • Same create-with-balance behaviour for missing parties.
//
// All three return Plain Old Data + a summary block so the API
// endpoints can ship a tiny preview to the browser and replay the
// plan inside one withTransaction on commit.
// ============================================================
import type { ParsedAgewise, ParsedClientwise, ParsedFamilywise } from './upload-parser';

const FMT = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// ─── Snapshot row used by the diff builders ────────────────────
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

// ─── AGEWISE plan ──────────────────────────────────────────────
export type AgewisePlan = {
  type: 'agewise';
  toCreate: ParsedAgewise[];
  toUpdate: Array<{
    party: string;
    before: CurrentAccount;
    after:  Pick<ParsedAgewise, 'bill'|'d30'|'d60'|'d90'|'d90p'>;
    changes: string[];
  }>;
  toClose: Array<{ party: string; before: CurrentAccount }>;
  collections: Array<{
    party: string; family: string | null; exec: string | null; cm: string | null;
    prevOutstanding: number; newOutstanding: number; amount: number;
  }>;
  promisesKept: Array<{ promiseId: string; party: string; outstandingNow: number }>;
  newHoldCandidates: Array<{ party: string; outstanding: number; reason: string }>;
  tierSuggestions: Array<{ party: string; from: string; to: string }>;
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

function computeTier(bill: number, d30: number, d60: number, d90: number, d90p: number): string {
  if (bill <= 0) return 'A';
  const ratio90p = d90p / Math.max(bill, 1);
  const ratio90  = (d90 + d90p) / Math.max(bill, 1);
  if (ratio90p > 0.5 || d90p > 200000) return 'E';
  if (ratio90  > 0.5 || d90 + d90p > 100000) return 'D';
  if (d60 > 50000 || (d60 + d90 + d90p) / Math.max(bill, 1) > 0.4) return 'C';
  if (d30 > bill * 0.6) return 'A';
  return 'B';
}

export function buildAgewisePlan(
  parsed: ParsedAgewise[],
  current: CurrentAccount[],
  openPromises: OpenPromise[],
  opts: { holdLimitMultiplier?: number; holdOver90Plus?: number } = {}
): AgewisePlan {
  const holdMult = opts.holdLimitMultiplier ?? 1;
  const hold90p  = opts.holdOver90Plus      ?? 50000;

  const byParty = new Map<string, CurrentAccount>();
  current.forEach(c => byParty.set(c.party.toUpperCase(), c));

  const toCreate: ParsedAgewise[] = [];
  const toUpdate: AgewisePlan['toUpdate'] = [];
  const collections: AgewisePlan['collections'] = [];
  const newHoldCandidates: AgewisePlan['newHoldCandidates'] = [];
  const tierSuggestions: AgewisePlan['tierSuggestions'] = [];
  const seenInFile = new Set<string>();
  let totalOutstanding = 0;

  for (const p of parsed) {
    const key = p.party.toUpperCase();
    seenInFile.add(key);
    totalOutstanding += p.bill;

    const cur = byParty.get(key);
    if (!cur) {
      toCreate.push(p);
      if (p.d90p > hold90p) {
        newHoldCandidates.push({ party: p.party, outstanding: p.bill, reason: `New account with ${FMT(p.d90p)} in 90+ bucket` });
      }
      tierSuggestions.push({ party: p.party, from: '—', to: computeTier(p.bill, p.d30, p.d60, p.d90, p.d90p) });
      continue;
    }
    const changes: string[] = [];
    if (Math.abs(p.bill - cur.bill) > 0.5) changes.push(`Outstanding ${FMT(cur.bill)} → ${FMT(p.bill)}`);
    if (Math.abs(p.d30 - cur.d30) > 0.5)   changes.push(`0-30: ${FMT(cur.d30)} → ${FMT(p.d30)}`);
    if (Math.abs(p.d60 - cur.d60) > 0.5)   changes.push(`31-60: ${FMT(cur.d60)} → ${FMT(p.d60)}`);
    if (Math.abs(p.d90 - cur.d90) > 0.5)   changes.push(`61-90: ${FMT(cur.d90)} → ${FMT(p.d90)}`);
    if (Math.abs(p.d90p - cur.d90p) > 0.5) changes.push(`90+: ${FMT(cur.d90p)} → ${FMT(p.d90p)}`);
    if (changes.length > 0) {
      toUpdate.push({
        party: cur.party, before: cur,
        after: { bill: p.bill, d30: p.d30, d60: p.d60, d90: p.d90, d90p: p.d90p },
        changes,
      });
    }
    if (p.bill < cur.bill - 0.5) {
      collections.push({
        party: cur.party, family: cur.family, exec: cur.exec, cm: cur.cm,
        prevOutstanding: cur.bill, newOutstanding: p.bill, amount: cur.bill - p.bill,
      });
    }
    const limit = cur.creditLimit;
    if (limit > 0 && p.bill > limit * holdMult && cur.alert !== 'On Hold') {
      newHoldCandidates.push({ party: cur.party, outstanding: p.bill, reason: `Outstanding ${FMT(p.bill)} exceeds credit limit ${FMT(limit)}` });
    } else if (p.d90p > hold90p && cur.alert !== 'On Hold') {
      newHoldCandidates.push({ party: cur.party, outstanding: p.bill, reason: `${FMT(p.d90p)} stuck in 90+ bucket` });
    }
    if (!cur.tierOverride) {
      const sug = computeTier(p.bill, p.d30, p.d60, p.d90, p.d90p);
      if (sug !== cur.tier) tierSuggestions.push({ party: cur.party, from: cur.tier, to: sug });
    }
  }

  const toClose: AgewisePlan['toClose'] = [];
  for (const cur of current) {
    if (seenInFile.has(cur.party.toUpperCase())) continue;
    if (cur.bill <= 0) continue;
    toClose.push({ party: cur.party, before: cur });
    collections.push({
      party: cur.party, family: cur.family, exec: cur.exec, cm: cur.cm,
      prevOutstanding: cur.bill, newOutstanding: 0, amount: cur.bill,
    });
  }

  const finalByParty = new Map<string, number>();
  for (const p of parsed) finalByParty.set(p.party.toUpperCase(), p.bill);
  for (const cur of current) {
    if (!finalByParty.has(cur.party.toUpperCase())) finalByParty.set(cur.party.toUpperCase(), 0);
  }
  const promisesKept: AgewisePlan['promisesKept'] = [];
  for (const prom of openPromises) {
    const bill = finalByParty.get(prom.party.toUpperCase());
    if (bill === undefined) continue;
    if (bill < prom.outstandingAt - 0.5) {
      promisesKept.push({ promiseId: prom.id, party: prom.party, outstandingNow: bill });
    }
  }

  const prevTotalOutstanding = current.reduce((s, c) => s + Number(c.bill), 0);
  const collectionAmount = collections.reduce((s, c) => s + c.amount, 0);
  return {
    type: 'agewise', toCreate, toUpdate, toClose, collections, promisesKept, newHoldCandidates, tierSuggestions,
    summary: {
      fileRows: parsed.length,
      currentAccounts: current.length,
      finalAccounts: current.length + toCreate.length,
      totalOutstanding, prevTotalOutstanding,
      delta: totalOutstanding - prevTotalOutstanding,
      createCount: toCreate.length, updateCount: toUpdate.length, closeCount: toClose.length,
      collectionCount: collections.length, collectionAmount,
      holdCount: newHoldCandidates.length, promisesKeptCount: promisesKept.length,
    },
  };
}

// ─── CLIENTWISE plan (exec assignment) ─────────────────────────
export type ClientwisePlan = {
  type: 'clientwise';
  toCreate: Array<{ party: string; exec: string | null; balance: number }>;
  toUpdate: Array<{ party: string; before: string | null; after: string; }>;
  unchanged: number;
  ungroupedRows: Array<{ party: string; balance: number }>;
  summary: {
    fileRows: number;
    distinctExecs: number;
    createCount: number;
    updateCount: number;
    unchanged: number;
    ungrouped: number;
  };
};

export function buildClientwisePlan(
  parsed: ParsedClientwise[],
  current: CurrentAccount[],
): ClientwisePlan {
  const byParty = new Map<string, CurrentAccount>();
  current.forEach(c => byParty.set(c.party.toUpperCase(), c));
  const toCreate: ClientwisePlan['toCreate'] = [];
  const toUpdate: ClientwisePlan['toUpdate'] = [];
  const ungrouped: ClientwisePlan['ungroupedRows'] = [];
  let unchanged = 0;
  const execs = new Set<string>();

  for (const p of parsed) {
    if (p.exec) execs.add(p.exec);
    else ungrouped.push({ party: p.party, balance: p.balance });
    const cur = byParty.get(p.party.toUpperCase());
    if (!cur) {
      toCreate.push({ party: p.party, exec: p.exec, balance: p.balance });
      continue;
    }
    const newExec = p.exec ?? cur.exec;
    if ((newExec ?? '') !== (cur.exec ?? '')) {
      toUpdate.push({ party: cur.party, before: cur.exec, after: newExec ?? '' });
    } else {
      unchanged++;
    }
  }

  return {
    type: 'clientwise', toCreate, toUpdate, unchanged,
    ungroupedRows: ungrouped,
    summary: {
      fileRows: parsed.length,
      distinctExecs: execs.size,
      createCount: toCreate.length,
      updateCount: toUpdate.length,
      unchanged,
      ungrouped: ungrouped.length,
    },
  };
}

// ─── FAMILYWISE plan (family assignment) ───────────────────────
export type FamilywisePlan = {
  type: 'familywise';
  toCreate: Array<{ party: string; family: string | null; balance: number }>;
  toUpdate: Array<{ party: string; before: string | null; after: string; }>;
  unchanged: number;
  ungroupedRows: Array<{ party: string; balance: number }>;
  summary: {
    fileRows: number;
    distinctFamilies: number;
    createCount: number;
    updateCount: number;
    unchanged: number;
    ungrouped: number;
  };
};

export function buildFamilywisePlan(
  parsed: ParsedFamilywise[],
  current: CurrentAccount[],
): FamilywisePlan {
  const byParty = new Map<string, CurrentAccount>();
  current.forEach(c => byParty.set(c.party.toUpperCase(), c));
  const toCreate: FamilywisePlan['toCreate'] = [];
  const toUpdate: FamilywisePlan['toUpdate'] = [];
  const ungrouped: FamilywisePlan['ungroupedRows'] = [];
  let unchanged = 0;
  const fams = new Set<string>();

  for (const p of parsed) {
    if (p.family) fams.add(p.family);
    else ungrouped.push({ party: p.party, balance: p.balance });
    const cur = byParty.get(p.party.toUpperCase());
    if (!cur) {
      toCreate.push({ party: p.party, family: p.family, balance: p.balance });
      continue;
    }
    const newFam = p.family ?? cur.family;
    if ((newFam ?? '') !== (cur.family ?? '')) {
      toUpdate.push({ party: cur.party, before: cur.family, after: newFam ?? '' });
    } else {
      unchanged++;
    }
  }

  return {
    type: 'familywise', toCreate, toUpdate, unchanged,
    ungroupedRows: ungrouped,
    summary: {
      fileRows: parsed.length,
      distinctFamilies: fams.size,
      createCount: toCreate.length,
      updateCount: toUpdate.length,
      unchanged,
      ungrouped: ungrouped.length,
    },
  };
}
