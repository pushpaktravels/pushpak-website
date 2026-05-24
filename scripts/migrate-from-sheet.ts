// ============================================================
// migrate-from-sheet.ts — one-time data migration: Google Sheet → Postgres
// ============================================================
// Reads each legacy sheet via the Sheets API, maps to Prisma models,
// upserts into Postgres. Idempotent: re-runs are safe and produce the
// same final state.
//
// REQUIRES:
//   - LEGACY_SHEET_ID env var (set already in .env.example)
//   - GOOGLE_SERVICE_ACCOUNT_KEY env var: JSON of a service account
//     that has been shared into the legacy sheet with Viewer access.
//
// Run with: npm run migrate-from-sheet
//
// This is a TEMPLATE — fill in the per-sheet mapping logic for each
// table as we port more endpoints. The Account migration is wired up
// as a working example you can run today against the legacy sheet.
// ============================================================
import 'dotenv/config';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';

// Script-local Prisma client — uses DIRECT_URL to bypass the pooler so bulk
// upserts don't trip the "prepared statement already exists" pgbouncer bug.
const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
  log: ['error'],
});

const SHEET_ID = process.env.LEGACY_SHEET_ID || '';
const SA_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';

if (!SHEET_ID) throw new Error('LEGACY_SHEET_ID is not set');
if (!SA_KEY)   throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set');

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(SA_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function readSheet(name: string): Promise<string[][]> {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A:Z` });
  return (r.data.values || []) as string[][];
}

function num(v: any): number { const n = parseFloat(String(v).replace(/[,₹\s]/g, '')); return isNaN(n) ? 0 : n; }
function str(v: any): string { return v == null ? '' : String(v).trim(); }
function parseDate(v: any): Date | null { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }

// ─── ACCOUNTS (from 10_TRACKER) ───────────────────────────────
async function migrateAccounts() {
  console.log('▸ Reading 10_TRACKER…');
  const rows = await readSheet('10_TRACKER');
  if (rows.length < 2) { console.log('  (no rows)'); return; }
  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const data = rows.slice(1);

  // Tracker columns from legacy 06_Tracker.gs TRACKER_COLS:
  // 1 Tier, 2 Alert, 3 Exec, 4 Party, 5 Family, 6 Outstanding, 7 D30, 8 D60, 9 D90, 10 D90P,
  // 11 Stage, 12 Recent Call, 13 Outcome, 14 Next FU, 15 Pay Expected, 16 Credit Period,
  // 17 OnTime%, 18 History, 19 MgtNote, 20 Status, 21 OnHold, 22 Credit Limit, 23 Credit Util,
  // 24 CM, 25 Tier Override, 26 Last Touched

  let imported = 0;
  for (const r of data) {
    const party = str(r[3]); // Party column (0-indexed col 3 = 4th column)
    if (!party) continue;
    await prisma.account.upsert({
      where: { party },
      update: {
        family: str(r[4]) || null, exec: str(r[2]) || null, cm: str(r[23]) || null,
        tier: str(r[0]) || 'A', alert: str(r[1]) || null,
        bill: num(r[5]), d30: num(r[6]), d60: num(r[7]), d90: num(r[8]), d90p: num(r[9]),
        stage: str(r[10]) || null,
        recentCall: parseDate(r[11]), callOutcome: str(r[12]) || null,
        nextFu: parseDate(r[13]), payExpected: parseDate(r[14]),
        creditPeriod: str(r[15]) || null, onTimePct: str(r[16]) || null,
        history: str(r[17]) || null, mgtNote: str(r[18]) || null,
        status: str(r[19]) || 'Pending', onHold: str(r[20]) || null,
        creditLimit: num(r[21]),
        tierOverride: str(r[24]) || null,
        lastTouched: parseDate(r[25]),
      },
      create: {
        party,
        family: str(r[4]) || null, exec: str(r[2]) || null, cm: str(r[23]) || null,
        tier: str(r[0]) || 'A', alert: str(r[1]) || null,
        bill: num(r[5]), d30: num(r[6]), d60: num(r[7]), d90: num(r[8]), d90p: num(r[9]),
        stage: str(r[10]) || null,
        recentCall: parseDate(r[11]), callOutcome: str(r[12]) || null,
        nextFu: parseDate(r[13]), payExpected: parseDate(r[14]),
        creditPeriod: str(r[15]) || null, onTimePct: str(r[16]) || null,
        history: str(r[17]) || null, mgtNote: str(r[18]) || null,
        status: str(r[19]) || 'Pending', onHold: str(r[20]) || null,
        creditLimit: num(r[21]),
        tierOverride: str(r[24]) || null,
        lastTouched: parseDate(r[25]),
      },
    });
    imported++;
  }
  console.log(`  ✓ ${imported} accounts`);
}

// ─── CLIENT MASTER (from 13_CLIENT_MASTER) ────────────────────
// TODO: implement when porting the Contact tab — column layout in legacy 10_ClientMaster.gs

// ─── PROMISES (from 11_PROMISE_LEDGER) ────────────────────────
// TODO: implement when porting the Promise tab

// ─── HOLDS (from 12_BOOKING_HOLD) ─────────────────────────────
// TODO

// ─── PAYMENT PLANS (from 14_PAYMENT_PLANS) ────────────────────
// TODO

// ─── LEGAL (from 15_LEGAL_LEDGER) ─────────────────────────────
// TODO

// ─── COLLECTIONS (from 96_COLLECTIONS_LOG) ────────────────────
// TODO

// ─── HISTORY (from 91_ACCOUNT_HISTORY) ────────────────────────
// TODO

// ─── SETTINGS (from 99_SETTINGS) ──────────────────────────────
// TODO

async function main() {
  console.log(`Migrating from sheet ${SHEET_ID}\n`);
  await migrateAccounts();
  // await migrateClientMaster();
  // await migratePromises();
  // ...
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
