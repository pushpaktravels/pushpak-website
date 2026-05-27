// ============================================================
// upload-parser.ts — turn a FinBook XLS/CSV buffer into rows.
// ============================================================
// FinBook + most accounting exports give us a "party-wise outstanding /
// ageing" sheet. Column headers vary slightly across exports, so we
// auto-detect by header keyword instead of hard-coding indices.
//
// Output: { headers, rows, sheetName, columnMap, warnings }
// where each row is a normalised ParsedAccount with all known fields
// filled in. Unknown columns get carried through in `extras` so the
// preview UI can show the user what we ignored.
//
// SECURITY: This module never touches the DB. It just parses bytes.
// Callers (the /api/upload endpoints) own auth, audit, and writes.
// ============================================================
import * as XLSX from 'xlsx';

export type ParsedAccount = {
  party: string;
  family: string | null;
  exec: string | null;
  cm: string | null;
  branch: string | null;
  bill: number;       // total outstanding
  d30: number;        // 0-30 bucket
  d60: number;        // 31-60
  d90: number;        // 61-90
  d90p: number;       // 90+
  creditLimit: number;
  creditPeriod: string | null;
  // Anything we couldn't map cleanly:
  extras: Record<string, string | number | null>;
};

export type ColumnMap = {
  party?: number;
  family?: number;
  exec?: number;
  cm?: number;
  branch?: number;
  bill?: number;
  d30?: number;
  d60?: number;
  d90?: number;
  d90p?: number;
  creditLimit?: number;
  creditPeriod?: number;
};

export type ParseResult = {
  ok: boolean;
  error?: string;
  sheetName?: string;
  headers?: string[];
  columnMap?: ColumnMap;
  rows?: ParsedAccount[];
  rawRowCount?: number;
  warnings?: string[];
};

// ─── Column header keywords ───────────────────────────────────
// Each known field maps to a list of substring hints. We match
// case-insensitively against the *header text* of every column.
// First match wins. Order in the list matters for ambiguity.
const HEADER_HINTS: Record<keyof ColumnMap, string[]> = {
  party:        ['party name', 'customer name', 'account name', 'ledger', 'party', 'customer', 'account', 'name'],
  family:       ['family', 'group', 'parent'],
  exec:         ['exec', 'executive', 'sales person', 'salesperson', 'rm', 'owner'],
  cm:           ['collection mgr', 'collection manager', 'cm name', 'cm'],
  branch:       ['branch', 'location', 'office'],
  bill:         ['outstanding', 'total due', 'balance', 'total amount', 'closing balance', 'bill'],
  d30:          ['0-30', '0 to 30', 'd30', '1-30', '0-29', 'current', 'not due'],
  d60:          ['31-60', '30-60', 'd60', '61-90... no'], // 61-90 handled separately
  d90:          ['61-90', '60-90', 'd90', '91-120'],
  d90p:         ['90+', '>90', 'over 90', 'd90+', 'd90p', '120+', '>120', 'above 90', 'beyond'],
  creditLimit:  ['credit limit', 'limit', 'credit amount'],
  creditPeriod: ['credit period', 'credit days', 'credit terms', 'terms', 'period'],
};

// Substring guard so 60 doesn't match "0-60" twice; we score and
// pick the most specific hint.
function detectColumns(headers: string[]): { map: ColumnMap; warnings: string[] } {
  const map: ColumnMap = {};
  const warnings: string[] = [];
  const used = new Set<number>();

  // Normalize headers once.
  const norm = headers.map(h => String(h || '').trim().toLowerCase());

  // For each field, find the best-scoring column.
  (Object.keys(HEADER_HINTS) as (keyof ColumnMap)[]).forEach((field) => {
    const hints = HEADER_HINTS[field];
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < norm.length; i++) {
      if (used.has(i)) continue;
      const h = norm[i];
      if (!h) continue;
      for (let s = 0; s < hints.length; s++) {
        const hint = hints[s];
        if (h.includes(hint)) {
          // Earlier hints = higher score. Also reward exact match.
          const score = (hints.length - s) * 10 + (h === hint ? 5 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
      }
    }
    if (bestIdx >= 0) {
      map[field] = bestIdx;
      used.add(bestIdx);
    }
  });

  // Sanity warnings.
  if (map.party === undefined) warnings.push('No "Party / Customer" column detected — every row will be skipped.');
  if (map.bill === undefined)  warnings.push('No "Outstanding / Balance" column detected — totals will be zero.');
  if (map.d30 === undefined && map.d60 === undefined && map.d90 === undefined && map.d90p === undefined) {
    warnings.push('No ageing bucket columns detected — aging will be blank.');
  }

  return { map, warnings };
}

function toNumber(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  // Strip ₹ , spaces, parentheses (accounting negatives)
  const s = String(v).trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[₹,\s()]/g, '').replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return 0;
  return negative ? -n : n;
}

function toStr(v: any): string {
  if (v == null) return '';
  return String(v).trim();
}

// Pick the most likely sheet from a workbook. Preference:
//   1. Sheet whose name contains "outstanding" / "ageing" / "tracker" / "debtor"
//   2. Largest non-empty sheet
function pickSheet(wb: XLSX.WorkBook): string {
  const names = wb.SheetNames;
  if (names.length === 0) return '';
  const keywords = ['outstanding', 'ageing', 'aging', 'tracker', 'debtor', 'party'];
  for (const kw of keywords) {
    const hit = names.find(n => n.toLowerCase().includes(kw));
    if (hit) return hit;
  }
  // Largest sheet wins
  let best = names[0];
  let bestRows = 0;
  for (const n of names) {
    const ref = wb.Sheets[n]?.['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r;
    if (rowCount > bestRows) { bestRows = rowCount; best = n; }
  }
  return best;
}

// Find the header row. FinBook exports often have 2-6 junk title rows
// at the top (company name, period, etc.). We scan the first 15 rows
// and pick the one with the most "header-like" cells (i.e. matches
// any of our known hints).
function findHeaderRow(grid: any[][]): number {
  const maxScan = Math.min(15, grid.length);
  let bestRow = 0;
  let bestScore = -1;
  for (let r = 0; r < maxScan; r++) {
    const row = grid[r] || [];
    let score = 0;
    for (const cell of row) {
      const s = String(cell || '').trim().toLowerCase();
      if (!s) continue;
      for (const hints of Object.values(HEADER_HINTS)) {
        for (const hint of hints) {
          if (s.includes(hint)) { score += 1; break; }
        }
      }
    }
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }
  return bestRow;
}

export function parseWorkbookBuffer(buf: Buffer, opts: { fileName?: string } = {}): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  } catch (e: any) {
    return { ok: false, error: `Couldn't open file: ${e.message || 'unknown error'}` };
  }

  const sheetName = pickSheet(wb);
  if (!sheetName) return { ok: false, error: 'Workbook has no sheets.' };
  const ws = wb.Sheets[sheetName];
  if (!ws) return { ok: false, error: `Sheet ${sheetName} not found.` };

  const grid = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  });

  if (grid.length === 0) {
    return { ok: false, error: 'Sheet is empty.', sheetName };
  }

  const headerRowIdx = findHeaderRow(grid);
  const headers = (grid[headerRowIdx] || []).map((h: any) => String(h || '').trim());
  const dataRows = grid.slice(headerRowIdx + 1);

  if (headers.length === 0) {
    return { ok: false, error: 'Could not locate header row.', sheetName };
  }

  const { map, warnings } = detectColumns(headers);

  if (map.party === undefined) {
    return {
      ok: false,
      sheetName,
      headers,
      warnings,
      error: 'No party / customer / account name column was found in the file. Please check your export.',
    };
  }

  const rows: ParsedAccount[] = [];
  let rawCount = 0;
  for (const r of dataRows) {
    rawCount++;
    if (!Array.isArray(r)) continue;
    const partyVal = toStr(r[map.party!]);
    if (!partyVal) continue;
    // Skip rows that look like totals.
    const partyLower = partyVal.toLowerCase();
    if (/^(grand total|total|sub total|subtotal)\b/.test(partyLower)) continue;

    const extras: Record<string, string | number | null> = {};
    headers.forEach((h, idx) => {
      // Carry through anything not in the mapped set
      if (Object.values(map).includes(idx)) return;
      if (!h) return;
      const v = r[idx];
      if (v == null || v === '') return;
      extras[h] = typeof v === 'number' ? v : toStr(v);
    });

    rows.push({
      party:        partyVal,
      family:       map.family       !== undefined ? (toStr(r[map.family])       || null) : null,
      exec:         map.exec         !== undefined ? (toStr(r[map.exec])         || null) : null,
      cm:           map.cm           !== undefined ? (toStr(r[map.cm])           || null) : null,
      branch:       map.branch       !== undefined ? (toStr(r[map.branch])       || null) : null,
      bill:         map.bill         !== undefined ? toNumber(r[map.bill])             : 0,
      d30:          map.d30          !== undefined ? toNumber(r[map.d30])              : 0,
      d60:          map.d60          !== undefined ? toNumber(r[map.d60])              : 0,
      d90:          map.d90          !== undefined ? toNumber(r[map.d90])              : 0,
      d90p:         map.d90p         !== undefined ? toNumber(r[map.d90p])             : 0,
      creditLimit:  map.creditLimit  !== undefined ? toNumber(r[map.creditLimit])      : 0,
      creditPeriod: map.creditPeriod !== undefined ? (toStr(r[map.creditPeriod]) || null) : null,
      extras,
    });
  }

  // Dedup: if a party appears twice, sum its numeric columns and merge contact-y fields.
  const merged = new Map<string, ParsedAccount>();
  for (const r of rows) {
    const key = r.party.toUpperCase();
    const ex = merged.get(key);
    if (!ex) { merged.set(key, r); continue; }
    ex.bill += r.bill;
    ex.d30 += r.d30;
    ex.d60 += r.d60;
    ex.d90 += r.d90;
    ex.d90p += r.d90p;
    ex.family       = ex.family       || r.family;
    ex.exec         = ex.exec         || r.exec;
    ex.cm           = ex.cm           || r.cm;
    ex.branch       = ex.branch       || r.branch;
    ex.creditLimit  = Math.max(ex.creditLimit, r.creditLimit);
    ex.creditPeriod = ex.creditPeriod || r.creditPeriod;
    ex.extras       = { ...ex.extras, ...r.extras };
  }
  const deduped = Array.from(merged.values());

  return {
    ok: true,
    sheetName,
    headers,
    columnMap: map,
    rows: deduped,
    rawRowCount: rawCount,
    warnings,
  };
}
