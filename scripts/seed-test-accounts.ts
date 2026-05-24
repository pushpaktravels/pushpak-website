// ============================================================
// scripts/seed-test-accounts.ts
// ============================================================
// Seeds 5 realistic test accounts so we can verify Hold Check,
// Account Drawer, and Team Worklist visually before the real
// FinBook upload pipeline (Session 6) lands.
//
// Idempotent: deletes all rows with "TEST_" id prefix first,
// then re-inserts a fresh set. Run as many times as you want.
//
// Cleanup when real data arrives:
//   DELETE FROM "PointEvent"     WHERE party LIKE 'TEST %';
//   DELETE FROM "AccountHistory" WHERE party LIKE 'TEST %';
//   DELETE FROM "HoldRecord"     WHERE party LIKE 'TEST %';
//   DELETE FROM "Promise"        WHERE party LIKE 'TEST %';
//   DELETE FROM "ClientMaster"   WHERE party LIKE 'TEST %';
//   DELETE FROM "Account"        WHERE party LIKE 'TEST %';
//
// Run with:
//   npx tsx scripts/seed-test-accounts.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Fixture: 5 accounts spanning every tier + every hold status ─
const ACCOUNTS = [
  {
    id: 'TEST_acc_rajesh',
    party: 'TEST RAJESH TRADERS',
    family: 'AGARWAL GROUP',
    exec: 'ANIL',
    cm: 'VANSHIKA',
    tier: 'C',
    alert: 'Escalate',
    bill: 285000, d30: 50000, d60: 80000, d90: 85000, d90p: 70000,
    stage: 'S2 — Owner reminder',
    stageCalls: 3,
    onHold: 'Candidate',
    status: 'Pending',
    creditLimit: 200000, creditPeriod: '≤30 days', onTimePct: '62%',
    history: 'Slow payer since FY24. Owner aware.',
  },
  {
    id: 'TEST_acc_vikas',
    party: 'TEST VIKAS METAL WORKS',
    family: 'METAL GROUP',
    exec: 'ANIL',
    cm: 'VANSHIKA',
    tier: 'A',
    alert: null,
    bill: 45000, d30: 45000, d60: 0, d90: 0, d90p: 0,
    stage: 'S1 — AP / Accounts',
    stageCalls: 1,
    onHold: null,
    status: 'Pending',
    creditLimit: 100000, creditPeriod: '≤30 days', onTimePct: '94%',
    history: 'Reliable. Pays within 25 days on average.',
  },
  {
    id: 'TEST_acc_sharma',
    party: 'TEST SHARMA STEEL & CO',
    family: 'SHARMA ENTERPRISES',
    exec: 'VISHAL',
    cm: 'VANSHIKA',
    tier: 'E',
    alert: 'On Hold',
    bill: 1250000, d30: 0, d60: 0, d90: 200000, d90p: 1050000,
    stage: 'S4 — Legal review',
    stageCalls: 12,
    onHold: 'Active',
    status: 'Legal',
    creditLimit: 500000, creditPeriod: '≤60 days', onTimePct: '18%',
    history: 'Legal notice issued. No response in 45 days.',
  },
  {
    id: 'TEST_acc_agarwal',
    party: 'TEST AGARWAL TEXTILES',
    family: 'AGARWAL GROUP',
    exec: 'ANIL',
    cm: 'VANSHIKA',
    tier: 'B',
    alert: 'Due Soon',
    bill: 142500, d30: 120000, d60: 22500, d90: 0, d90p: 0,
    stage: 'S1 — AP / Accounts',
    stageCalls: 2,
    onHold: null,
    status: 'Pending',
    creditLimit: 150000, creditPeriod: '≤30 days', onTimePct: '81%',
    history: 'Promised payment by month-end. Tracking.',
  },
  {
    id: 'TEST_acc_patel',
    party: 'TEST PATEL EXPORTS',
    family: 'PATEL & SONS',
    exec: 'VANSHIKA',
    cm: 'VANSHIKA',
    tier: 'D',
    alert: 'Review by Mgt',
    bill: 825000, d30: 0, d60: 50000, d90: 300000, d90p: 475000,
    stage: 'S3 — Mgt escalation',
    stageCalls: 7,
    onHold: 'Active',
    status: 'Doubtful',
    creditLimit: 300000, creditPeriod: '≤60 days', onTimePct: '34%',
    history: 'Payment plan attempted twice, both broken. Considering legal.',
  },
];

const CLIENT_MASTERS = [
  { party: 'TEST RAJESH TRADERS',     phone1: '+91 98200 11111', phone2: null,                whatsapp: '+91 98200 11111', email: 'accounts@rajeshtraders.test', owner: 'Rajesh Agarwal', ap: 'Sunita',  admin: null, vip: 'NO',  creditLimit: 200000, creditTerms: 30 },
  { party: 'TEST VIKAS METAL WORKS',  phone1: '+91 98200 22222', phone2: null,                whatsapp: '+91 98200 22222', email: 'vikas@metalworks.test',       owner: 'Vikas Shah',    ap: 'Pooja',   admin: null, vip: 'NO',  creditLimit: 100000, creditTerms: 30 },
  { party: 'TEST SHARMA STEEL & CO',  phone1: '+91 98200 33333', phone2: '+91 22 4567 8901',  whatsapp: '+91 98200 33333', email: 'mr.sharma@sharmasteel.test',  owner: 'R.K. Sharma',   ap: null,      admin: 'Geeta', vip: 'NO', creditLimit: 500000, creditTerms: 60 },
  { party: 'TEST AGARWAL TEXTILES',   phone1: '+91 98200 44444', phone2: null,                whatsapp: '+91 98200 44444', email: 'mukesh@agarwaltex.test',      owner: 'Mukesh Agarwal',ap: 'Reema',   admin: null, vip: 'YES', creditLimit: 150000, creditTerms: 30 },
  { party: 'TEST PATEL EXPORTS',      phone1: '+91 98200 55555', phone2: '+91 79 2222 3344',  whatsapp: '+91 98200 55555', email: 'finance@patelexports.test',   owner: 'Mahesh Patel',  ap: 'Devang',  admin: null, vip: 'NO',  creditLimit: 300000, creditTerms: 60 },
];

// Promises per party — mix of statuses
const PROMISES = [
  { party: 'TEST RAJESH TRADERS',    expectedBy: '2026-04-10', outstandingAt: 350000, status: 'Broken', exec: 'ANIL', amountReceived: 0,      settledOn: null,         notes: 'Promised but did not pay. AP unresponsive.' },
  { party: 'TEST RAJESH TRADERS',    expectedBy: '2026-06-05', outstandingAt: 285000, status: 'Open',   exec: 'ANIL', amountReceived: 0,      settledOn: null,         notes: 'Confirmed partial payment of ₹50k by Friday.' },
  { party: 'TEST VIKAS METAL WORKS', expectedBy: '2026-06-15', outstandingAt: 45000,  status: 'Open',   exec: 'ANIL', amountReceived: 0,      settledOn: null,         notes: 'On track.' },
  { party: 'TEST SHARMA STEEL & CO', expectedBy: '2026-02-20', outstandingAt: 1450000,status: 'Broken', exec: 'VISHAL', amountReceived: 50000, settledOn: null,        notes: 'Token amount only. Stopped responding after.' },
  { party: 'TEST SHARMA STEEL & CO', expectedBy: '2026-03-15', outstandingAt: 1400000,status: 'Broken', exec: 'VISHAL', amountReceived: 0,    settledOn: null,         notes: 'No payment, no communication.' },
  { party: 'TEST SHARMA STEEL & CO', expectedBy: '2026-04-30', outstandingAt: 1350000,status: 'Broken', exec: 'VISHAL', amountReceived: 100000,settledOn: null,        notes: 'Partial. Lawyer engaged after this.' },
  { party: 'TEST AGARWAL TEXTILES',  expectedBy: '2026-05-15', outstandingAt: 175000, status: 'Kept',   exec: 'ANIL', amountReceived: 175000,settledOn: '2026-05-14', notes: 'Paid in full one day early. Strong client.' },
  { party: 'TEST PATEL EXPORTS',     expectedBy: '2026-03-20', outstandingAt: 925000, status: 'Broken', exec: 'VANSHIKA', amountReceived: 0,  settledOn: null,         notes: 'Payment plan broken. Plan B in progress.' },
  { party: 'TEST PATEL EXPORTS',     expectedBy: '2026-05-10', outstandingAt: 825000, status: 'Cancelled', exec: 'VANSHIKA', amountReceived: 0, settledOn: null,       notes: 'Cancelled — switched to direct legal review.' },
];

const HOLDS = [
  { party: 'TEST RAJESH TRADERS',    status: 'Candidate', outstanding: 285000,  reason: 'Outstanding > ₹2.5L and aging > 60 days. Candidate for active hold.' },
  { party: 'TEST SHARMA STEEL & CO', status: 'Active',    outstanding: 1250000, reason: 'Legal case filed. All new bookings blocked.', confirmedBy: 'VANSHIKA', confirmedOn: '2026-04-12' },
  { party: 'TEST PATEL EXPORTS',     status: 'Active',    outstanding: 825000,  reason: 'Two broken payment plans. Booking blocked pending mgt review.', confirmedBy: 'VANSHIKA', confirmedOn: '2026-05-01' },
];

const HISTORY = [
  // Rajesh — newest first when fetched
  { party: 'TEST RAJESH TRADERS', action: 'Call logged',     newValue: 'AP confirmed ₹50k by Friday',         exec: 'ANIL',     daysAgo: 2 },
  { party: 'TEST RAJESH TRADERS', action: 'Stage advanced',  newValue: 'S1 → S2 (Owner reminder)',            exec: 'ANIL',     daysAgo: 5 },
  { party: 'TEST RAJESH TRADERS', action: 'Promise broken',  newValue: '₹3.5L due 10-Apr — not received',     exec: 'ANIL',     daysAgo: 14 },
  { party: 'TEST RAJESH TRADERS', action: 'Promise added',   newValue: '₹3.5L by 10-Apr',                     exec: 'ANIL',     daysAgo: 30 },
  // Vikas
  { party: 'TEST VIKAS METAL WORKS', action: 'Promise added', newValue: '₹45k by 15-Jun',                      exec: 'ANIL', daysAgo: 3 },
  { party: 'TEST VIKAS METAL WORKS', action: 'Account created', newValue: 'Imported from FinBook',             exec: 'SYSTEM', daysAgo: 45 },
  // Sharma — many entries (problem account)
  { party: 'TEST SHARMA STEEL & CO', action: 'Legal notice sent',   newValue: 'Via lawyer @ ₹12.5L outstanding', exec: 'VANSHIKA', daysAgo: 8 },
  { party: 'TEST SHARMA STEEL & CO', action: 'Hold activated',      newValue: 'All new bookings blocked',        exec: 'VANSHIKA', daysAgo: 12 },
  { party: 'TEST SHARMA STEEL & CO', action: 'Promise broken',      newValue: '3rd broken in 3 months',          exec: 'VISHAL',   daysAgo: 25 },
  { party: 'TEST SHARMA STEEL & CO', action: 'Mgt escalation',      newValue: 'Escalated to owner for review',   exec: 'VISHAL',   daysAgo: 35 },
  // Agarwal
  { party: 'TEST AGARWAL TEXTILES', action: 'Promise kept',   newValue: '₹1.75L received in full',              exec: 'ANIL', daysAgo: 10 },
  { party: 'TEST AGARWAL TEXTILES', action: 'Call logged',    newValue: 'Confirmed cheque dispatched',          exec: 'ANIL', daysAgo: 11 },
  // Patel
  { party: 'TEST PATEL EXPORTS', action: 'Hold activated',    newValue: 'Booking blocked pending mgt review',   exec: 'VANSHIKA', daysAgo: 23 },
  { party: 'TEST PATEL EXPORTS', action: 'Payment plan cancelled', newValue: 'Switched to direct legal review',exec: 'VANSHIKA', daysAgo: 24 },
  { party: 'TEST PATEL EXPORTS', action: 'Promise broken',    newValue: '₹9.25L plan broken at instalment 2',   exec: 'VANSHIKA', daysAgo: 65 },
];

// ─── Payment plans (Doubtful Ledger) ──────────────────────────
// Patel has a broken plan; Rajesh has an active one currently in progress.
const PAYMENT_PLANS = [
  {
    id: 'TEST_pp_patel',
    party: 'TEST PATEL EXPORTS',
    planTotal: 925000,
    startDate: '2026-02-01',
    cancelledAt: '2026-04-12',  // broken & cancelled
    instalments: [
      { instNo: 1, dueDate: '2026-02-15', amount: 200000, status: 'Received', received: 200000, settledOn: '2026-02-14' },
      { instNo: 2, dueDate: '2026-03-15', amount: 200000, status: 'Broken',   received: 0,      settledOn: null },
      { instNo: 3, dueDate: '2026-04-15', amount: 200000, status: 'Cancelled',received: 0,      settledOn: null },
      { instNo: 4, dueDate: '2026-05-15', amount: 175000, status: 'Cancelled',received: 0,      settledOn: null },
      { instNo: 5, dueDate: '2026-06-15', amount: 150000, status: 'Cancelled',received: 0,      settledOn: null },
    ],
  },
  {
    id: 'TEST_pp_rajesh',
    party: 'TEST RAJESH TRADERS',
    planTotal: 285000,
    startDate: '2026-05-01',
    cancelledAt: null,
    instalments: [
      { instNo: 1, dueDate: '2026-05-15', amount: 95000, status: 'Received', received: 95000, settledOn: '2026-05-14' },
      { instNo: 2, dueDate: '2026-06-15', amount: 95000, status: 'Pending',  received: 0,     settledOn: null },
      { instNo: 3, dueDate: '2026-07-15', amount: 95000, status: 'Pending',  received: 0,     settledOn: null },
    ],
  },
];

// ─── Legal cases (Legal Ledger) ───────────────────────────────
const LEGAL_CASES = [
  {
    id: 'TEST_lc_sharma',
    party: 'TEST SHARMA STEEL & CO',
    filedOn: '2026-04-12',
    outstanding: 1250000,
    status: 'InCourt',
    lawyer: 'Mehta & Associates',
    caseRef: 'COMM/2026/187',
    nextHearing: '2026-06-20',
    notes: 'First hearing scheduled. Opposing counsel claims partial payment dispute.',
    closedOn: null,
  },
  {
    id: 'TEST_lc_old_demo',
    party: 'TEST SHARMA STEEL & CO',
    filedOn: '2025-11-08',
    outstanding: 1450000,
    status: 'Filed',
    lawyer: 'Mehta & Associates',
    caseRef: 'COMM/2025/422',
    nextHearing: null,
    notes: 'Initial notice filed in 2025. Restarted as the larger 2026 case after non-response.',
    closedOn: null,
  },
];

// ─── Point events (Scoreboard) ────────────────────────────────
// Distributed across the 3 execs we use in test data, weighted so
// VANSHIKA (owner) is mid-pack, ANIL is leader, VISHAL is bottom
// (he owns the legal-stuck Sharma account → lots of broken promises).
const POINT_EVENTS = [
  // ANIL (38 pts total)
  { exec: 'ANIL',     event: 'CALL',           party: 'TEST RAJESH TRADERS',    points: 1,  daysAgo: 1 },
  { exec: 'ANIL',     event: 'CALL',           party: 'TEST AGARWAL TEXTILES',  points: 1,  daysAgo: 2 },
  { exec: 'ANIL',     event: 'CALL',           party: 'TEST VIKAS METAL WORKS', points: 1,  daysAgo: 3 },
  { exec: 'ANIL',     event: 'CALL',           party: 'TEST RAJESH TRADERS',    points: 1,  daysAgo: 5 },
  { exec: 'ANIL',     event: 'CALL',           party: 'TEST AGARWAL TEXTILES',  points: 1,  daysAgo: 7 },
  { exec: 'ANIL',     event: 'PROMISE_ADDED',  party: 'TEST RAJESH TRADERS',    points: 2,  daysAgo: 6 },
  { exec: 'ANIL',     event: 'PROMISE_ADDED',  party: 'TEST VIKAS METAL WORKS', points: 2,  daysAgo: 4 },
  { exec: 'ANIL',     event: 'PROMISE_KEPT',   party: 'TEST AGARWAL TEXTILES',  points: 5,  daysAgo: 10 },
  { exec: 'ANIL',     event: 'PROMISE_KEPT',   party: 'TEST RAJESH TRADERS',    points: 5,  daysAgo: 14 },
  { exec: 'ANIL',     event: 'HOLD_NEW',       party: 'TEST RAJESH TRADERS',    points: 3,  daysAgo: 9 },
  { exec: 'ANIL',     event: 'RECOVERY',       party: 'TEST AGARWAL TEXTILES',  points: 8,  daysAgo: 10 },
  { exec: 'ANIL',     event: 'RECOVERY',       party: 'TEST RAJESH TRADERS',    points: 8,  daysAgo: 14 },
  // VANSHIKA (24 pts total) — owner doing some hands-on work
  { exec: 'VANSHIKA', event: 'CALL',           party: 'TEST PATEL EXPORTS',     points: 1,  daysAgo: 2 },
  { exec: 'VANSHIKA', event: 'CALL',           party: 'TEST SHARMA STEEL & CO', points: 1,  daysAgo: 6 },
  { exec: 'VANSHIKA', event: 'HOLD_NEW',       party: 'TEST PATEL EXPORTS',     points: 3,  daysAgo: 23 },
  { exec: 'VANSHIKA', event: 'HOLD_NEW',       party: 'TEST SHARMA STEEL & CO', points: 3,  daysAgo: 12 },
  { exec: 'VANSHIKA', event: 'RECOVERY',       party: 'TEST PATEL EXPORTS',     points: 8,  daysAgo: 35 },
  { exec: 'VANSHIKA', event: 'PROMISE_BROKEN', party: 'TEST PATEL EXPORTS',     points: -3, daysAgo: 65 },
  { exec: 'VANSHIKA', event: 'STALE',          party: 'TEST PATEL EXPORTS',     points: -1, daysAgo: 18 },
  // VISHAL (4 pts total) — has the problem account, lots of broken promises
  { exec: 'VISHAL',   event: 'CALL',           party: 'TEST SHARMA STEEL & CO', points: 1,  daysAgo: 8 },
  { exec: 'VISHAL',   event: 'RECOVERY',       party: 'TEST SHARMA STEEL & CO', points: 8,  daysAgo: 28 },
  { exec: 'VISHAL',   event: 'PROMISE_BROKEN', party: 'TEST SHARMA STEEL & CO', points: -3, daysAgo: 25 },
  { exec: 'VISHAL',   event: 'PROMISE_BROKEN', party: 'TEST SHARMA STEEL & CO', points: -3, daysAgo: 60 },
  { exec: 'VISHAL',   event: 'PROMISE_BROKEN', party: 'TEST SHARMA STEEL & CO', points: -3, daysAgo: 95 },
  { exec: 'VISHAL',   event: 'STALE',          party: 'TEST SHARMA STEEL & CO', points: -1, daysAgo: 15 },
  { exec: 'VISHAL',   event: 'STALE',          party: 'TEST SHARMA STEEL & CO', points: -1, daysAgo: 22 },
];

// ─── Settings defaults ────────────────────────────────────────
// All visible/editable on the Settings page once it ships.
const SETTINGS = [
  { key: 'DUE_SOON_DAYS',         value: '5',       category: 'Workflow', label: 'Days before due date to flag "Due Soon"' },
  { key: 'STALE_DAYS',            value: '7',       category: 'Workflow', label: 'Days untouched before account flagged stale' },
  { key: 'HIGH_TIER_THRESHOLD',   value: '500000',  category: 'Tiers',    label: 'Outstanding ₹ amount above which tier auto-bumps' },
  { key: 'CRITICAL_TIER_AGING',   value: '90',      category: 'Tiers',    label: 'Days overdue qualifying for tier D/E' },
  { key: 'POINTS_PER_CALL',       value: '1',       category: 'Points',   label: 'Points awarded for each call logged' },
  { key: 'POINTS_PROMISE_ADDED',  value: '2',       category: 'Points',   label: 'Points for adding a promise' },
  { key: 'POINTS_PROMISE_KEPT',   value: '5',       category: 'Points',   label: 'Points for a kept promise' },
  { key: 'POINTS_PROMISE_BROKEN', value: '-3',      category: 'Points',   label: 'Points (negative) for a broken promise' },
  { key: 'POINTS_HOLD_NEW',       value: '3',       category: 'Points',   label: 'Points for flagging/activating a hold' },
  { key: 'POINTS_RECOVERY',       value: '8',       category: 'Points',   label: 'Points per recovery event' },
  { key: 'POINTS_STALE_PENALTY',  value: '-1',      category: 'Points',   label: 'Daily penalty for stale accounts' },
];

// ─── Collection log entries (Collection List) ─────────────────
// Recent payments received — each tied to a real account in our test set.
const COLLECTIONS = [
  { party: 'TEST AGARWAL TEXTILES', exec: 'ANIL',     amount: 175000, prevOutstanding: 317500,  newOutstanding: 142500,  trigger: 'Manual mark-paid',           daysAgo: 10, notes: 'Cheque cleared.' },
  { party: 'TEST PATEL EXPORTS',    exec: 'VANSHIKA', amount: 200000, prevOutstanding: 1125000, newOutstanding: 925000,  trigger: 'Refresh by VANSHIKA01',      daysAgo: 35, notes: 'Plan instalment 1.' },
  { party: 'TEST SHARMA STEEL & CO',exec: 'VISHAL',   amount: 100000, prevOutstanding: 1350000, newOutstanding: 1250000, trigger: 'Refresh by VANSHIKA01',      daysAgo: 28, notes: 'Token amount via legal route.' },
  { party: 'TEST RAJESH TRADERS',   exec: 'ANIL',     amount: 95000,  prevOutstanding: 380000,  newOutstanding: 285000,  trigger: 'Refresh by VANSHIKA01',      daysAgo: 14, notes: 'Plan instalment 1.' },
];

async function main() {
  console.log('Connecting to', process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@'));

  // 1) Wipe existing TEST_ rows (idempotent reseed)
  console.log('Clearing previous TEST data...');
  await pool.query(`DELETE FROM "PointEvent"     WHERE party LIKE 'TEST %' OR id LIKE 'TEST_%'`);
  await pool.query(`DELETE FROM "CollectionLog"  WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "LegalCase"      WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "PlanInstalment" WHERE "planId" LIKE 'TEST_%'`);
  await pool.query(`DELETE FROM "PaymentPlan"    WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "AccountHistory" WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "HoldRecord"     WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "Promise"        WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "ClientMaster"   WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "Account"        WHERE party LIKE 'TEST %'`);
  await pool.query(`DELETE FROM "RefreshToken"   WHERE "userId" LIKE 'TEST_user_%'`);
  await pool.query(`DELETE FROM "User"           WHERE id LIKE 'TEST_user_%'`);

  // 2) Accounts
  // Note: Account.updatedAt is @updatedAt in Prisma (auto-set on writes via Prisma)
  // but raw SQL bypasses that, so we set NOW() explicitly. Same for ClientMaster.
  console.log('Inserting accounts...');
  for (const a of ACCOUNTS) {
    await pool.query(
      `INSERT INTO "Account"
        (id, party, family, exec, cm, tier, alert, bill, d30, d60, d90, d90p,
         stage, "stageCalls", "onHold", status, "creditLimit", "creditPeriod", "onTimePct", history,
         "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, NOW())`,
      [a.id, a.party, a.family, a.exec, a.cm, a.tier, a.alert, a.bill, a.d30, a.d60, a.d90, a.d90p,
       a.stage, a.stageCalls, a.onHold, a.status, a.creditLimit, a.creditPeriod, a.onTimePct, a.history]
    );
  }

  // 3) ClientMaster
  console.log('Inserting client master rows...');
  for (const c of CLIENT_MASTERS) {
    await pool.query(
      `INSERT INTO "ClientMaster"
        (id, party, family, phone1, phone2, whatsapp, email, owner, ap, admin, vip,
         "creditLimit", "creditTerms", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())`,
      [`TEST_cm_${c.party.replace(/\W+/g,'_').toLowerCase()}`, c.party,
       ACCOUNTS.find(a => a.party === c.party)?.family ?? null,
       c.phone1, c.phone2, c.whatsapp, c.email, c.owner, c.ap, c.admin, c.vip,
       c.creditLimit, c.creditTerms]
    );
  }

  // 4) Promises
  console.log('Inserting promises...');
  for (let i = 0; i < PROMISES.length; i++) {
    const p = PROMISES[i];
    await pool.query(
      `INSERT INTO "Promise"
        (id, party, family, "expectedBy", exec, "outstandingAt", status, "amountReceived", "settledOn", notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [`TEST_pr_${i}`, p.party,
       ACCOUNTS.find(a => a.party === p.party)?.family ?? null,
       p.expectedBy, p.exec, p.outstandingAt, p.status,
       p.amountReceived, p.settledOn, p.notes]
    );
  }

  // 5) Hold records
  console.log('Inserting hold records...');
  for (let i = 0; i < HOLDS.length; i++) {
    const h = HOLDS[i] as any;
    await pool.query(
      `INSERT INTO "HoldRecord"
        (id, party, family, outstanding, reason, status, "confirmedBy", "confirmedOn")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`TEST_hr_${i}`, h.party,
       ACCOUNTS.find(a => a.party === h.party)?.family ?? null,
       h.outstanding, h.reason, h.status,
       h.confirmedBy ?? null, h.confirmedOn ?? null]
    );
  }

  // 6) History — backdate ts with daysAgo offset
  console.log('Inserting history...');
  for (let i = 0; i < HISTORY.length; i++) {
    const h = HISTORY[i];
    const ts = new Date(Date.now() - h.daysAgo * 86400_000);
    await pool.query(
      `INSERT INTO "AccountHistory"
        (id, ts, party, exec, action, "newValue", source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`TEST_hist_${i}`, ts.toISOString(), h.party, h.exec, h.action, h.newValue, 'TestSeed']
    );
  }

  // 7) Payment plans (Doubtful Ledger)
  console.log('Inserting payment plans...');
  for (const pp of PAYMENT_PLANS) {
    await pool.query(
      `INSERT INTO "PaymentPlan" (id, party, family, "planTotal", "startDate", "cancelledAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        pp.id, pp.party,
        ACCOUNTS.find(a => a.party === pp.party)?.family ?? null,
        pp.planTotal, pp.startDate, pp.cancelledAt,
      ]
    );
    for (const inst of pp.instalments) {
      await pool.query(
        `INSERT INTO "PlanInstalment"
          (id, "planId", "instNo", "dueDate", amount, status, received, "settledOn")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `${pp.id}_inst_${inst.instNo}`, pp.id, inst.instNo,
          inst.dueDate, inst.amount, inst.status, inst.received, inst.settledOn,
        ]
      );
    }
  }
  const totalInstalments = PAYMENT_PLANS.reduce((n, p) => n + p.instalments.length, 0);

  // 8) Legal cases
  console.log('Inserting legal cases...');
  for (const lc of LEGAL_CASES) {
    await pool.query(
      `INSERT INTO "LegalCase"
        (id, party, family, "filedOn", outstanding, status, lawyer, "caseRef",
         "nextHearing", notes, "closedOn", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
      [
        lc.id, lc.party,
        ACCOUNTS.find(a => a.party === lc.party)?.family ?? null,
        lc.filedOn, lc.outstanding, lc.status, lc.lawyer, lc.caseRef,
        lc.nextHearing, lc.notes, lc.closedOn,
      ]
    );
  }

  // 9) Collection log entries
  console.log('Inserting collection entries...');
  for (let i = 0; i < COLLECTIONS.length; i++) {
    const c = COLLECTIONS[i];
    const date = new Date(Date.now() - c.daysAgo * 86400_000).toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO "CollectionLog"
        (id, date, party, family, exec, cm, amount, "prevOutstanding", "newOutstanding", trigger, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        `TEST_col_${i}`, date, c.party,
        ACCOUNTS.find(a => a.party === c.party)?.family ?? null,
        c.exec, 'VANSHIKA',
        c.amount, c.prevOutstanding, c.newOutstanding, c.trigger, c.notes,
      ]
    );
  }

  // 10) Point events (Scoreboard)
  console.log('Inserting point events...');
  for (let i = 0; i < POINT_EVENTS.length; i++) {
    const p = POINT_EVENTS[i];
    const ts = new Date(Date.now() - p.daysAgo * 86400_000).toISOString();
    await pool.query(
      `INSERT INTO "PointEvent" (id, ts, exec, event, party, points, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`TEST_pt_${i}`, ts, p.exec, p.event, p.party, p.points, null]
    );
  }

  // 11a) Ensure the three scoreboard execs exist as User rows with scoreboard ON.
  // ANIL + VISHAL don't exist in the 34-person production roster, so we create
  // them as TEST_user_* records that get wiped on reseed. VANSHIKA already
  // exists in the real roster; we just flip her scoreboard bit on.
  console.log('Ensuring scoreboard execs exist as users...');
  const dummyHash = '$argon2id$v=19$m=1,t=1,p=1$dGVzdHRlc3R0ZXN0$AAAAAAAAAAAAAAAAAAAAAA'; // unusable for login
  await pool.query(
    `INSERT INTO "User"
      (id, "execId", name, role, "passwordHash", scoreboard, active, badge,
       team, "viewPerms", "viewReadOnly", "updatedAt")
     VALUES
      ('TEST_user_anil',   'TESTANIL01',   'ANIL',   'exec'::"Role", $1, true, true, 'Executive',
       ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], NOW()),
      ('TEST_user_vishal', 'TESTVISHAL01', 'VISHAL', 'exec'::"Role", $1, true, true, 'Executive',
       ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], NOW())
     ON CONFLICT ("execId") DO UPDATE SET scoreboard = true`,
    [dummyHash]
  );
  await pool.query(`UPDATE "User" SET scoreboard = true WHERE name = 'VANSHIKA'`);

  // 11) Settings — upsert so we don't blow away user-edited values on reseed
  console.log('Upserting settings...');
  for (const s of SETTINGS) {
    await pool.query(
      `INSERT INTO "Setting" (key, value, category, "updatedAt", "updatedBy")
       VALUES ($1, $2, $3, NOW(), 'TestSeed')
       ON CONFLICT (key) DO NOTHING`,
      [s.key, s.value, s.category]
    );
  }

  console.log('\n✓ Seeded:');
  console.log(`   ${ACCOUNTS.length} accounts`);
  console.log(`   ${CLIENT_MASTERS.length} client masters`);
  console.log(`   ${PROMISES.length} promises`);
  console.log(`   ${HOLDS.length} hold records`);
  console.log(`   ${HISTORY.length} history entries`);
  console.log(`   ${PAYMENT_PLANS.length} payment plans (${totalInstalments} instalments)`);
  console.log(`   ${LEGAL_CASES.length} legal cases`);
  console.log(`   ${COLLECTIONS.length} collection entries`);
  console.log(`   ${POINT_EVENTS.length} point events`);
  console.log(`   ${SETTINGS.length} settings (upserted, existing values preserved)`);
  console.log(`   2 test users (ANIL, VISHAL) + VANSHIKA scoreboard ON`);
  console.log('\nReady. Try the new Session 5 pages: Performance, Scoreboard, Insights, Settings, Users & Authorities.');

  await pool.end();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
