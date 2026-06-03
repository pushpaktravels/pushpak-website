// ============================================================
// lib/finbook.ts — THE single server-side chokepoint for FinBook.
// ============================================================
// Every call to the FinBook (Calico) accounting API goes through this
// module. Nothing else may `fetch` FinBook directly. That gives us one
// place to enforce: the api-key header, timeouts, redaction, idempotency,
// dry-run safety and a uniform never-throws result type — so a flaky
// network or a bad payload can never half-bill a client or crash a desk.
//
// SERVER ONLY. Importing this from client code would leak FINBOOK_API_KEY
// into the browser bundle — it reads process.env and is never referenced
// by any component. (lib/views.ts is the client-safe boundary; this is not.)
//
// ── Modes (env FINBOOK_MODE) ────────────────────────────────────
//   'dryrun' (default)  → never touches the network. Validates + logs the
//                         payload and returns a deterministic *simulated*
//                         success, so the whole portal flow can be built
//                         and demoed before Calico unblocks our IP. Reads
//                         (ledger/limit) return realistic synthetic data.
//   'live'              → real HTTPS calls with x-api-key auth.
//   'off'               → hard kill-switch: every call returns a disabled
//                         error. Use to instantly stop all FinBook traffic.
//
// The mode is read fresh on every call, so flipping the env var (and
// redeploying) is the kill-switch — no code change, no double-bill risk.
// ============================================================
import {
  fbDate, fbDateTime,
  type FbClientMasterBody, type FbPaxMasterBody, type FbSalesDetailsBody,
  type FbReceiptBody, type FbJournalBody,
  type FbLedger, type FbLedgerLine, type FbClientLimit,
} from './finbook-schemas';

export type FinbookMode = 'live' | 'dryrun' | 'off';

export function finbookMode(): FinbookMode {
  const m = (process.env.FINBOOK_MODE || 'dryrun').toLowerCase();
  if (m === 'live') return 'live';
  if (m === 'off') return 'off';
  return 'dryrun';
}
export function finbookBranchId(): string {
  return process.env.FINBOOK_BRANCH_ID || '00000001';
}
function baseUrl(): string {
  return (process.env.FINBOOK_BASE_URL || 'https://api.finbooklive.com/beta').replace(/\/$/, '');
}
function apiKey(): string {
  return process.env.FINBOOK_API_KEY || '';
}

// Uniform, never-throws result. Callers branch on `ok` and never see an
// exception bubble out of FinBook — a billing action must fail *cleanly*.
export type FinbookResult<T> =
  | { ok: true; data: T; mode: FinbookMode; simulated: boolean }
  | { ok: false; error: string; status?: number; mode: FinbookMode; simulated: boolean };

const TIMEOUT_MS = 20_000;

// Redact the api-key from anything we log. We never print the key.
function redact(s: string): string {
  const k = apiKey();
  return k ? s.split(k).join('***') : s;
}

// ─── The core caller ────────────────────────────────────────────
// `simulate` builds the dry-run response so each method stays declarative.
async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: {
    body?: Record<string, any>;
    queryHeader?: Record<string, string>; // extra headers (none used today)
    simulate: () => T;                     // dry-run / no-network response
    parse: (raw: any) => T;                // normalise a live response
    label: string;                         // for logs
  },
): Promise<FinbookResult<T>> {
  const mode = finbookMode();

  if (mode === 'off') {
    return { ok: false, error: 'FinBook integration is switched off (FINBOOK_MODE=off)', mode, simulated: false };
  }

  if (mode === 'dryrun') {
    // No network. Pretend it worked so the portal flow is fully testable.
    // eslint-disable-next-line no-console
    console.log(`[finbook:dryrun] ${opts.label} ${method} ${path}`,
      opts.body ? redact(JSON.stringify(opts.body)).slice(0, 800) : '');
    try {
      return { ok: true, data: opts.simulate(), mode, simulated: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'dry-run simulate failed', mode, simulated: true };
    }
  }

  // ── live ──
  if (!apiKey()) {
    return { ok: false, error: 'FINBOOK_API_KEY is not set', mode, simulated: false };
  }
  const url = `${baseUrl()}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'x-api-key': apiKey(),
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.queryHeader || {}),
      },
      body: method === 'POST' ? JSON.stringify(opts.body || {}) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let raw: any = text;
    try { raw = text ? JSON.parse(text) : null; } catch { /* keep as text */ }

    if (!res.ok) {
      const msg = (raw && (raw.message || raw.error)) || `FinBook ${res.status}`;
      // eslint-disable-next-line no-console
      console.error(`[finbook:live] ${opts.label} ${res.status}`, redact(String(text)).slice(0, 500));
      return { ok: false, error: String(msg), status: res.status, mode, simulated: false };
    }
    return { ok: true, data: opts.parse(raw), mode, simulated: false };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? `FinBook timed out after ${TIMEOUT_MS / 1000}s` : (e?.message || 'FinBook request failed'),
      mode, simulated: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Deterministic fake FinBook id from a seed, so dry-run results are stable
// across calls for the same input (good for demos + idempotency testing).
function fakeId(prefix: string, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `${prefix}${String(h % 1_000_000).padStart(6, '0')}`;
}

// ════════════════════════════════════════════════════════════════
// WRITE methods — used by the (later) automation verticals. Each returns
// the FinBook id it created/echoed. Safe to wire now; in dry-run they just
// simulate. The outbox worker is what will actually invoke these.
// ════════════════════════════════════════════════════════════════

export function createClient(body: FbClientMasterBody): Promise<FinbookResult<{ clientId: string; raw?: any }>> {
  return call('POST', '/clientmaster', {
    body,
    label: 'createClient',
    simulate: () => ({ clientId: fakeId('CCA', body.client_Name + body.branch_ID) }),
    parse: (raw) => ({ clientId: raw?.client_id || raw?.clientId || raw?.id || '', raw }),
  });
}

export function addPassenger(body: FbPaxMasterBody): Promise<FinbookResult<{ paxId: string; raw?: any }>> {
  return call('POST', '/clientmaster', {
    body,
    label: 'addPassenger',
    simulate: () => ({ paxId: fakeId('PAX', body.paxName + (body.clientID || '')) }),
    parse: (raw) => ({ paxId: raw?.pax_id || raw?.paxId || raw?.id || '', raw }),
  });
}

export function addSalesDetail(body: FbSalesDetailsBody): Promise<FinbookResult<{ docNo: string; raw?: any }>> {
  return call('POST', '/salesdetails', {
    body,
    label: 'addSalesDetail',
    simulate: () => ({ docNo: body.doc_nos || fakeId('INV', body.refr_key || body.ticketno || body.pax || '') }),
    parse: (raw) => ({ docNo: raw?.doc_nos || raw?.docNo || raw?.invoice_no || '', raw }),
  });
}

export function addReceipt(body: FbReceiptBody): Promise<FinbookResult<{ docNo: string; raw?: any }>> {
  return call('POST', '/retsceiptspayments', {
    body,
    label: 'addReceipt',
    simulate: () => ({ docNo: body.doc_nos || fakeId('RCT', body.refr_key || body.client_id) }),
    parse: (raw) => ({ docNo: raw?.doc_nos || raw?.docNo || '', raw }),
  });
}

export function addJournal(body: FbJournalBody): Promise<FinbookResult<{ docNo: string; raw?: any }>> {
  return call('POST', '/jrmaster', {
    body,
    label: 'addJournal',
    simulate: () => ({ docNo: body.doc_nos || fakeId('JRN', body.refr_key || body.debit_acc_id) }),
    parse: (raw) => ({ docNo: raw?.doc_nos || raw?.docNo || '', raw }),
  });
}

// ════════════════════════════════════════════════════════════════
// READ methods — the "Live ledger in portal" vertical. Read-only, so safe
// to expose first. Dry-run returns realistic synthetic data so the UI can
// be built/approved before Calico unblocks live access.
// ════════════════════════════════════════════════════════════════

export function getClientLedger(args: {
  clientId: string; from: Date | string; to: Date | string; year?: string;
}): Promise<FinbookResult<FbLedger>> {
  const startdate = fbDate(args.from);
  const enddate = fbDate(args.to);
  const year = args.year || String(new Date(enddate).getFullYear());
  const qs = new URLSearchParams({ clientid: args.clientId, startdate, enddate, year }).toString();
  return call('GET', `/clientledger?${qs}`, {
    label: 'getClientLedger',
    simulate: () => synthLedger(args.clientId, startdate, enddate),
    parse: (raw) => normaliseLedger(args.clientId, raw),
  });
}

export function getClientLimit(args: {
  clientId: string; branchId?: string;
}): Promise<FinbookResult<FbClientLimit>> {
  const branch = args.branchId || finbookBranchId();
  const path = `/clientlimit/${encodeURIComponent(args.clientId)}/${encodeURIComponent(branch)}`;
  return call('GET', path, {
    label: 'getClientLimit',
    simulate: () => synthLimit(args.clientId),
    parse: (raw) => normaliseLimit(args.clientId, raw),
  });
}

// ─── Live-response normalisers ──────────────────────────────────
// FinBook's exact ledger/limit response keys aren't in the param docs, so
// we defensively read several likely key names and coerce to numbers. When
// we see the first real live payload these can be tightened.
function num(v: any): number {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function normaliseLedger(clientId: string, raw: any): FbLedger {
  const arr: any[] = Array.isArray(raw) ? raw
    : Array.isArray(raw?.lines) ? raw.lines
    : Array.isArray(raw?.data) ? raw.data
    : Array.isArray(raw?.ledger) ? raw.ledger : [];
  const lines: FbLedgerLine[] = arr.map((r) => ({
    date: r.date || r.doc_date || r.txnDate || '',
    docType: r.docType || r.doc_type || r.type || r.doc_prf || '',
    docNo: String(r.docNo || r.doc_nos || r.doc_no || ''),
    narration: r.narration || r.particulars || r.description || '',
    debit: num(r.debit ?? r.dr),
    credit: num(r.credit ?? r.cr),
    balance: num(r.balance ?? r.running_balance),
    refKey: r.refr_key || r.refKey || undefined,
  }));
  const opening = num(raw?.opening ?? raw?.openingBalance);
  const closing = num(raw?.closing ?? raw?.closingBalance ?? (lines.length ? lines[lines.length - 1].balance : opening));
  return { clientId, clientName: raw?.clientName || raw?.client_Name, opening, closing, lines };
}
function normaliseLimit(clientId: string, raw: any): FbClientLimit {
  const creditLimit = num(raw?.creditLimit ?? raw?.credit_limit ?? raw?.limit);
  const outstanding = num(raw?.outstanding ?? raw?.dues ?? raw?.balance);
  const available = raw?.available != null ? num(raw.available) : creditLimit - outstanding;
  return { clientId, creditLimit, outstanding, available, currency: raw?.currency || 'INR' };
}

// ─── Dry-run synthetic data ─────────────────────────────────────
// Deterministic from the clientId so demos are stable. Clearly fictional
// numbers; the UI badges them as "Simulated" so no one mistakes them.
function seedNum(s: string, mod: number): number {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
function synthLedger(clientId: string, startdate: string, enddate: string): FbLedger {
  const opening = 5000 + seedNum(clientId, 40000);
  let bal = opening;
  const base = new Date(startdate).getTime();
  const span = Math.max(1, new Date(enddate).getTime() - base);
  const n = 5 + (seedNum(clientId + 'n', 5));
  const lines: FbLedgerLine[] = [];
  for (let i = 0; i < n; i++) {
    const when = new Date(base + (span * (i + 1)) / (n + 1));
    const isInvoice = (seedNum(clientId + i, 3) !== 0);
    const amt = 2000 + seedNum(clientId + 'a' + i, 30000);
    const debit = isInvoice ? amt : 0;
    const credit = isInvoice ? 0 : amt;
    bal = bal + debit - credit;
    lines.push({
      date: fbDate(when),
      docType: isInvoice ? 'Invoice' : 'Receipt',
      docNo: `${isInvoice ? 'IW' : 'RW'}${String(1000 + i)}`,
      narration: isInvoice ? 'Air ticket — DEL/BOM' : 'Payment received — UPI',
      debit, credit, balance: bal,
      refKey: isInvoice ? `FBSIM${seedNum(clientId + i, 999999)}` : undefined,
    });
  }
  return { clientId, clientName: 'Simulated client', opening, closing: bal, lines };
}
function synthLimit(clientId: string): FbClientLimit {
  const creditLimit = 50_000 + seedNum(clientId, 200_000);
  const outstanding = seedNum(clientId + 'o', creditLimit);
  return { clientId, creditLimit, outstanding, available: creditLimit - outstanding, currency: 'INR' };
}

// Re-export the date helpers so callers building payloads import them from
// the client (the one module they already depend on).
export { fbDate, fbDateTime };
