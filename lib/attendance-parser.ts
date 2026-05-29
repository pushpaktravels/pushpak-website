// ============================================================
// attendance-parser.ts — read the biometric "DailyAttendance_
// DetailedReport" .xls export into structured per-employee rows.
// ============================================================
// File shape (single sheet, department-grouped):
//   row 0-3  banner: title, date range, company, "Attendance Date : 29-May-2026"
//   "Department" row  → col 3 = department name
//   "SNo" row         → column header (repeats per department)
//   "$N" rows         → one employee each
//
// Column layout (0-based), confirmed against real exports:
//   1 SNo("$N")  2 E.Code  3 Name  5 Shift  6 S.InTime  8 S.OutTime
//   10 A.InTime  11 A.OutTime  12 WorkDur  13 OT  14 TotDur
//   15 LateBy    16 EarlyGoingBy  17 Status  19 Punch Records
//
// We capture raw fields only. Daily classification (grace, late
// counting, half-day, etc.) is the job of attendance-classify.ts —
// the parser does NOT trust the machine's own Status/LateBy for
// payroll decisions, it just records them for reference.
// ============================================================
import * as XLSX from 'xlsx';

const COL = {
  sno: 1, eCode: 2, name: 3, shift: 5,
  schedIn: 6, schedOut: 8, actIn: 10, actOut: 11,
  workDur: 12, ot: 13, totDur: 14,
  lateBy: 15, earlyGoing: 16, status: 17, punches: 19,
} as const;

export type BiometricRow = {
  machineCode: string;       // E.Code as printed ("16", "19")
  name: string;
  department: string | null;
  shift: string | null;      // "GS", "N", "NS", etc.
  scheduledIn: string | null;  // "HH:MM" or null (NS / 00:00 = no shift)
  scheduledOut: string | null;
  actualIn: string | null;     // "HH:MM" or null (no punch)
  actualOut: string | null;
  lateByMin: number;           // machine-reported, reference only
  earlyGoingMin: number;       // machine-reported, reference only
  workDurMin: number;
  machineStatus: string;       // raw, trimmed: "Present" / "Absent" / "Absent (No OutPunch)"
  hasInPunch: boolean;
  hasOutPunch: boolean;
  punchRecords: string | null;
};

export type BiometricParse =
  | {
      ok: true;
      sheetName: string;
      reportDate: string | null;   // "YYYY-MM-DD" from the "Attendance Date" banner
      rows: BiometricRow[];
      warnings: string[];
    }
  | { ok: false; error: string };

function toStr(v: any): string {
  if (v == null) return '';
  return String(v).trim();
}

// "09:30" / "9:52" / "00:00" → minutes since midnight, or null for
// blank / "00:00" (machine prints 00:00 to mean "no value").
function timeToMin(v: any, { zeroIsNull = true }: { zeroIsNull?: boolean } = {}): number | null {
  const s = toStr(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if (zeroIsNull && min === 0) return null;
  return min;
}

// Same but returns the normalized "HH:MM" string (zero-padded) or null.
function timeToHHMM(v: any, { zeroIsNull = true }: { zeroIsNull?: boolean } = {}): string | null {
  const min = timeToMin(v, { zeroIsNull });
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// "1:24" / "00:43" → minutes (never null; blank → 0).
function durToMin(v: any): number {
  const s = toStr(v);
  const m = s.match(/^(\d{1,3}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Parse "Attendance Date : 29-May-2026" → "2026-05-29".
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};
function findReportDate(grid: any[][]): string | null {
  const maxScan = Math.min(8, grid.length);
  for (let i = 0; i < maxScan; i++) {
    const row = grid[i] || [];
    for (let c = 0; c < row.length; c++) {
      if (toStr(row[c]).toLowerCase().startsWith('attendance date')) {
        // value is in a later cell on the same row
        for (let d = c + 1; d < row.length; d++) {
          const iso = parseDateCell(toStr(row[d]));
          if (iso) return iso;
        }
      }
    }
    // also try the "May 29 2026  To  ..." banner
    const joined = row.map(toStr).join(' ');
    const iso = parseDateCell(joined);
    if (iso) return iso;
  }
  return null;
}

function parseDateCell(s: string): string | null {
  if (!s) return null;
  // 29-May-2026  or  29 May 2026
  let m = s.match(/(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2, '0')}`;
  }
  // May 29 2026
  m = s.match(/([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[2]).padStart(2, '0')}`;
  }
  return null;
}

export function parseBiometric(buf: Buffer): BiometricParse {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  } catch (e: any) {
    return { ok: false, error: `Couldn't open file: ${e?.message || 'unknown error'}` };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'Workbook has no sheets.' };
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1, defval: '', blankrows: false, raw: false,
  });
  if (grid.length === 0) return { ok: false, error: `Sheet "${sheetName}" is empty.` };

  const reportDate = findReportDate(grid);
  const warnings: string[] = [];
  if (!reportDate) warnings.push('Could not read the attendance date from the file banner — you may need to set it manually.');

  const rows: BiometricRow[] = [];
  let currentDept: string | null = null;
  const seenCodes = new Set<string>();

  for (let i = 0; i < grid.length; i++) {
    const r = grid[i] || [];
    const c1 = toStr(r[COL.sno]);

    if (c1 === 'Department') {
      currentDept = toStr(r[COL.name]) || null;
      continue;
    }
    if (c1 === 'SNo') continue;          // repeated header
    if (!c1.startsWith('$')) continue;   // not a data row

    const machineCode = toStr(r[COL.eCode]);
    const name = toStr(r[COL.name]);
    if (!machineCode || !name) continue;

    const actualIn = timeToHHMM(r[COL.actIn]);
    const actualOut = timeToHHMM(r[COL.actOut]);
    const rawStatus = toStr(r[COL.status]);

    rows.push({
      machineCode,
      name,
      department: currentDept,
      shift: toStr(r[COL.shift]) || null,
      scheduledIn: timeToHHMM(r[COL.schedIn]),
      scheduledOut: timeToHHMM(r[COL.schedOut]),
      actualIn,
      actualOut,
      lateByMin: durToMin(r[COL.lateBy]),
      earlyGoingMin: durToMin(r[COL.earlyGoing]),
      workDurMin: durToMin(r[COL.workDur]),
      machineStatus: rawStatus,
      hasInPunch: actualIn != null,
      hasOutPunch: actualOut != null,
      punchRecords: toStr(r[COL.punches]) || null,
    });

    if (seenCodes.has(machineCode)) {
      warnings.push(`Machine code ${machineCode} (${name}) appears more than once in the file.`);
    }
    seenCodes.add(machineCode);
  }

  if (rows.length === 0) {
    return { ok: false, error: 'No employee rows found. Is this the DailyAttendance Detailed Report export?' };
  }

  return { ok: true, sheetName, reportDate, rows, warnings };
}
