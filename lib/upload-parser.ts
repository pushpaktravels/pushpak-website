// ============================================================
// upload-parser.ts — three dedicated parsers for FinBook exports.
// ============================================================
// FinBook gives us three different "Net Outstanding Statement"
// reports. They share the same 6-row banner + a "Description" header
// row, but the COLUMNS and STRUCTURE differ:
//
//   AGEWISE      (flat)         Description | Bill Amount | Days <= 30 | Days <= 60 | Days <= 90 | Days > 90
//   CLIENTWISE   (hierarchical) Description | Debit | Credit | Balance
//                  └─ empty-amount row = CLIENT (exec / owner)
//                     amount rows under it = parties belonging to that exec
//                     SubTotal row = end of that exec's section
//   FAMILYWISE   (hierarchical) Description | Debit | Credit | Balance
//                  └─ same pattern: empty-amount row = FAMILY group
//                     Sub-groups (also empty) may be nested — we use the
//                     most recent empty header as the operational family
//                     and ignore higher-level group rows.
//
// Each parser returns its own row shape so the commit logic stays clean.
// All three return a `grandTotal` value lifted from the file's footer
// so the preview can show "file says ₹6.46 cr — we read ₹6.46 cr ✓".
// ============================================================
import * as XLSX from 'xlsx';

export type ReportType = 'agewise' | 'clientwise' | 'familywise';

export type ParsedAgewise = {
  party: string;
  bill: number;     // Bill Amount (sum of all aging buckets, signed)
  d30: number;      // Days <= 30
  d60: number;      // Days <= 60   (FinBook column for 31-60)
  d90: number;      // Days <= 90   (FinBook column for 61-90)
  d90p: number;     // Days > 90
};

export type ParsedClientwise = {
  party: string;
  exec: string | null;   // the "client" header from FinBook
  debit: number;
  credit: number;
  balance: number;
};

export type ParsedFamilywise = {
  party: string;
  family: string | null; // the family/group header from FinBook
  debit: number;
  credit: number;
  balance: number;
};

type CommonOk = {
  ok: true;
  sheetName: string;
  headers: string[];
  rawRowCount: number;
  grandTotal: number;     // last row's Balance / Bill Amount
  warnings: string[];
};

export type ParseResult =
  | (CommonOk & { type: 'agewise';    rows: ParsedAgewise[] })
  | (CommonOk & { type: 'clientwise'; rows: ParsedClientwise[]; emptyExecs: string[] })
  | (CommonOk & { type: 'familywise'; rows: ParsedFamilywise[]; emptyFamilies: string[] })
  | { ok: false; error: string; headers?: string[]; sheetName?: string; warnings?: string[] };

// ─── Shared helpers ─────────────────────────────────────────────
function toNumber(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
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

// Load the workbook → first sheet → 2D grid.
function loadGrid(buf: Buffer): { sheetName: string; grid: any[][] } | { error: string } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  } catch (e: any) {
    return { error: `Couldn't open file: ${e.message || 'unknown error'}` };
  }
  const name = wb.SheetNames[0];
  if (!name) return { error: 'Workbook has no sheets.' };
  const ws = wb.Sheets[name];
  const grid = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1, defval: '', blankrows: false, raw: false,
  });
  if (grid.length === 0) return { error: `Sheet "${name}" is empty.` };
  return { sheetName: name, grid };
}

// Find the row containing "Description" in column A. Returns -1 if missing.
function findFinBookHeaderRow(grid: any[][]): number {
  const maxScan = Math.min(20, grid.length);
  for (let i = 0; i < maxScan; i++) {
    const cell = toStr(grid[i]?.[0]).toLowerCase();
    if (cell === 'description') return i;
  }
  return -1;
}

// Map a header label to a column index, normalising whitespace.
function findCol(headers: string[], ...candidates: string[]): number {
  const norm = headers.map(h => toStr(h).toLowerCase().replace(/\s+/g, ' '));
  for (const c of candidates) {
    const target = c.toLowerCase().replace(/\s+/g, ' ');
    const idx = norm.indexOf(target);
    if (idx >= 0) return idx;
  }
  // Fallback: substring match
  for (const c of candidates) {
    const target = c.toLowerCase().replace(/\s+/g, ' ');
    const idx = norm.findIndex(h => h.includes(target));
    if (idx >= 0) return idx;
  }
  return -1;
}

// Is this row's amount-cells block all empty? Used to detect group/family
// header rows in hierarchical reports.
function amountsAllEmpty(row: any[], cols: number[]): boolean {
  for (const c of cols) {
    const v = toStr(row[c]);
    if (v && parseFloat(v.replace(/[₹,\s]/g, '')) !== 0) return false;
    if (v && !/^[\d,.\s\-₹()]+$/.test(v)) return false;
  }
  // Truly empty cells
  return cols.every(c => toStr(row[c]) === '');
}

// Detect the file's grand-total row: party empty, amounts present.
// Returns the value from the relevant column (or 0 if no clean total).
function readGrandTotal(grid: any[][], headerRowIdx: number, valueCol: number): number {
  for (let i = grid.length - 1; i > headerRowIdx; i--) {
    const row = grid[i] || [];
    const desc = toStr(row[0]);
    const v = row[valueCol];
    if (desc === '' && v !== '' && v != null) {
      return toNumber(v);
    }
  }
  return 0;
}

const isSubTotalRow = (desc: string) => /^sub\s*total\b/i.test(desc) || /^total\b/i.test(desc) || /^grand\s*total\b/i.test(desc);

// ─── AGEWISE — flat ──────────────────────────────────────────────
function parseAgewise(grid: any[][], sheetName: string): ParseResult {
  const headerRowIdx = findFinBookHeaderRow(grid);
  if (headerRowIdx < 0) {
    return { ok: false, error: 'Could not find the "Description" header row in this file. Did you upload the right FinBook report?', sheetName };
  }
  const headers = (grid[headerRowIdx] || []).map(toStr);
  const cParty = 0;
  const cBill = findCol(headers, 'bill amount', 'bill  amount', 'balance', 'total');
  const cD30  = findCol(headers, 'days <= 30', 'days<=30', '0-30', 'days < 30', 'd30');
  const cD60  = findCol(headers, 'days <= 60', 'days<=60', '31-60', 'd60');
  const cD90  = findCol(headers, 'days <= 90', 'days<=90', '61-90', 'd90');
  const cD90p = findCol(headers, 'days > 90', 'days>90', '90+', '> 90', 'd90+');

  const warnings: string[] = [];
  if (cBill < 0) return { ok: false, error: 'No "Bill Amount" column found. This file might not be an Agewise report.', headers, sheetName };
  if (cD30 < 0 || cD60 < 0 || cD90 < 0 || cD90p < 0) {
    warnings.push('One or more aging-bucket columns were not detected. Aging breakdown may be incomplete.');
  }

  const dataRows = grid.slice(headerRowIdx + 1);
  const rows: ParsedAgewise[] = [];
  const byParty = new Map<string, ParsedAgewise>();
  let rawCount = 0;
  for (const r of dataRows) {
    rawCount++;
    if (!Array.isArray(r)) continue;
    const party = toStr(r[cParty]);
    if (!party) continue;
    if (isSubTotalRow(party)) continue;
    const row: ParsedAgewise = {
      party,
      bill: cBill >= 0 ? toNumber(r[cBill]) : 0,
      d30:  cD30  >= 0 ? toNumber(r[cD30])  : 0,
      d60:  cD60  >= 0 ? toNumber(r[cD60])  : 0,
      d90:  cD90  >= 0 ? toNumber(r[cD90])  : 0,
      d90p: cD90p >= 0 ? toNumber(r[cD90p]) : 0,
    };
    // Skip rows that are entirely zero (likely artefacts)
    if (row.bill === 0 && row.d30 === 0 && row.d60 === 0 && row.d90 === 0 && row.d90p === 0) continue;
    // Dedup: sum if party appears twice
    const key = party.toUpperCase();
    const ex = byParty.get(key);
    if (ex) {
      ex.bill += row.bill; ex.d30 += row.d30; ex.d60 += row.d60; ex.d90 += row.d90; ex.d90p += row.d90p;
    } else {
      byParty.set(key, row);
      rows.push(row);
    }
  }

  return {
    ok: true, type: 'agewise', sheetName, headers, rows,
    rawRowCount: rawCount,
    grandTotal: readGrandTotal(grid, headerRowIdx, cBill),
    warnings,
  };
}

// ─── Hierarchical (clientwise / familywise) ─────────────────────
type HierarchicalRow = {
  party: string;
  group: string | null;
  debit: number;
  credit: number;
  balance: number;
};

function parseHierarchical(
  grid: any[][], sheetName: string, label: 'client' | 'family',
): { rows: HierarchicalRow[]; emptyGroups: string[]; headers: string[]; headerRowIdx: number; rawRowCount: number; warnings: string[]; grandTotal: number } | { error: string; headers?: string[] } {
  const headerRowIdx = findFinBookHeaderRow(grid);
  if (headerRowIdx < 0) {
    return { error: 'Could not find the "Description" header row in this file. Did you upload the right FinBook report?' };
  }
  const headers = (grid[headerRowIdx] || []).map(toStr);
  const cParty   = 0;
  const cDebit   = findCol(headers, 'debit', 'dr');
  const cCredit  = findCol(headers, 'credit', 'cr');
  const cBalance = findCol(headers, 'balance', 'outstanding', 'net', 'amount');
  if (cBalance < 0 && cDebit < 0 && cCredit < 0) {
    return { error: 'No Debit / Credit / Balance column found. This file might not be a Clientwise or Familywise report.', headers };
  }
  const amtCols = [cDebit, cCredit, cBalance].filter(c => c >= 0);

  const dataRows = grid.slice(headerRowIdx + 1);
  const rows: HierarchicalRow[] = [];
  const emptySet = new Set<string>();
  // currentGroup persists from the most recent empty-amount header until a SubTotal.
  let currentGroup: string | null = null;
  let pendingHeader: string | null = null; // accumulates consecutive empty rows
  let rawCount = 0;

  for (const r of dataRows) {
    rawCount++;
    if (!Array.isArray(r)) continue;
    const desc = toStr(r[cParty]);
    if (!desc) continue; // blank row → ignore (grand total handled separately)
    if (isSubTotalRow(desc)) {
      // close out — any pending header that never got parties is "empty"
      if (pendingHeader) emptySet.add(pendingHeader);
      currentGroup = null;
      pendingHeader = null;
      continue;
    }
    const isEmpty = amountsAllEmpty(r, amtCols);
    if (isEmpty) {
      // promote a previous pending header to "empty" before overwriting it
      if (pendingHeader) emptySet.add(pendingHeader);
      pendingHeader = desc;
      continue;
    }
    // This is a party row with amounts.
    // If we had a pendingHeader, it becomes the active group.
    if (pendingHeader) {
      currentGroup = pendingHeader;
      pendingHeader = null;
    }
    rows.push({
      party: desc,
      group: currentGroup,
      debit:   cDebit   >= 0 ? toNumber(r[cDebit])   : 0,
      credit:  cCredit  >= 0 ? toNumber(r[cCredit])  : 0,
      balance: cBalance >= 0 ? toNumber(r[cBalance]) : 0,
    });
  }
  // Trailing empty header (no parties followed it before EOF)
  if (pendingHeader) emptySet.add(pendingHeader);

  const warnings: string[] = [];
  const ungrouped = rows.filter(r => !r.group).length;
  if (ungrouped > 0) warnings.push(`${ungrouped} row${ungrouped===1?'':'s'} had no ${label} header above them — they'll be ${label === 'client' ? 'left without an exec' : 'left without a family'}.`);

  return {
    rows,
    emptyGroups: Array.from(emptySet),
    headers, headerRowIdx,
    rawRowCount: rawCount,
    warnings,
    grandTotal: readGrandTotal(grid, headerRowIdx, cBalance >= 0 ? cBalance : amtCols[0]),
  };
}

function parseClientwise(grid: any[][], sheetName: string): ParseResult {
  const r = parseHierarchical(grid, sheetName, 'client');
  if ('error' in r) return { ok: false, error: r.error, headers: r.headers, sheetName };
  // Dedup by party (sum amounts, keep first exec)
  const byParty = new Map<string, ParsedClientwise>();
  const out: ParsedClientwise[] = [];
  for (const row of r.rows) {
    const key = row.party.toUpperCase();
    const ex = byParty.get(key);
    if (ex) {
      ex.debit += row.debit; ex.credit += row.credit; ex.balance += row.balance;
      ex.exec = ex.exec || row.group;
    } else {
      const v: ParsedClientwise = {
        party: row.party, exec: row.group,
        debit: row.debit, credit: row.credit, balance: row.balance,
      };
      byParty.set(key, v); out.push(v);
    }
  }
  return {
    ok: true, type: 'clientwise', sheetName, headers: r.headers,
    rows: out, emptyExecs: r.emptyGroups,
    rawRowCount: r.rawRowCount, grandTotal: r.grandTotal, warnings: r.warnings,
  };
}

function parseFamilywise(grid: any[][], sheetName: string): ParseResult {
  const r = parseHierarchical(grid, sheetName, 'family');
  if ('error' in r) return { ok: false, error: r.error, headers: r.headers, sheetName };
  const byParty = new Map<string, ParsedFamilywise>();
  const out: ParsedFamilywise[] = [];
  for (const row of r.rows) {
    const key = row.party.toUpperCase();
    const ex = byParty.get(key);
    if (ex) {
      ex.debit += row.debit; ex.credit += row.credit; ex.balance += row.balance;
      ex.family = ex.family || row.group;
    } else {
      const v: ParsedFamilywise = {
        party: row.party, family: row.group,
        debit: row.debit, credit: row.credit, balance: row.balance,
      };
      byParty.set(key, v); out.push(v);
    }
  }
  return {
    ok: true, type: 'familywise', sheetName, headers: r.headers,
    rows: out, emptyFamilies: r.emptyGroups,
    rawRowCount: r.rawRowCount, grandTotal: r.grandTotal, warnings: r.warnings,
  };
}

// ─── Public entry point ─────────────────────────────────────────
export function parseFinBook(buf: Buffer, reportType: ReportType): ParseResult {
  const loaded = loadGrid(buf);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { sheetName, grid } = loaded;
  switch (reportType) {
    case 'agewise':    return parseAgewise(grid, sheetName);
    case 'clientwise': return parseClientwise(grid, sheetName);
    case 'familywise': return parseFamilywise(grid, sheetName);
    default:           return { ok: false, error: `Unknown report type: ${reportType}` };
  }
}
