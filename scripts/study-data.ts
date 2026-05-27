// scripts/study-data.ts — read-only analysis of the production data
// to inform portal-improvement recommendations.
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n: number, of: number) => of > 0 ? `${(n*100/of).toFixed(1)}%` : '—';

async function main() {
  console.log('\n========== ACCOUNTS ==========');
  const ac = await pool.query<any>(`
    SELECT COUNT(*)::int AS n,
           SUM(bill)::float8 AS total,
           SUM(d30)::float8 AS d30, SUM(d60)::float8 AS d60,
           SUM(d90)::float8 AS d90, SUM(d90p)::float8 AS d90p,
           SUM(CASE WHEN bill < 0 THEN bill ELSE 0 END)::float8 AS credit_total,
           COUNT(*) FILTER (WHERE bill < 0)::int AS credit_count,
           COUNT(*) FILTER (WHERE bill = 0)::int AS zero_count,
           COUNT(*) FILTER (WHERE bill > 0)::int AS owing_count,
           MAX(bill)::float8 AS max_bill,
           AVG(bill) FILTER (WHERE bill > 0)::float8 AS avg_owing
      FROM "Account"`);
  const a = ac.rows[0];
  console.log(`  ${a.n} total accounts: ${a.owing_count} owing, ${a.zero_count} zero, ${a.credit_count} in credit`);
  console.log(`  Net outstanding: ${fmt(a.total)}`);
  console.log(`  Customers in credit (owe us nothing / advance): ${a.credit_count} parties totalling ${fmt(a.credit_total)}`);
  console.log(`  Largest single outstanding: ${fmt(a.max_bill)}`);
  console.log(`  Average outstanding (positive only): ${fmt(a.avg_owing)}`);

  console.log('\n  Aging breakdown:');
  const total = a.d30 + a.d60 + a.d90 + a.d90p;
  console.log(`    0-30:  ${fmt(a.d30)}  (${pct(a.d30, total)})`);
  console.log(`    31-60: ${fmt(a.d60)}  (${pct(a.d60, total)})`);
  console.log(`    61-90: ${fmt(a.d90)}  (${pct(a.d90, total)})`);
  console.log(`    90+:   ${fmt(a.d90p)}  (${pct(a.d90p, total)})  ← STUCK`);

  console.log('\n========== TIER DISTRIBUTION ==========');
  const tiers = await pool.query<any>(
    `SELECT tier, COUNT(*)::int AS n, SUM(bill)::float8 AS total
       FROM "Account" GROUP BY tier ORDER BY tier`);
  for (const t of tiers.rows) {
    console.log(`  Tier ${t.tier}: ${t.n.toString().padStart(3)} accounts · ${fmt(t.total)}`);
  }

  console.log('\n========== TOP 10 OUTSTANDING ==========');
  const top = await pool.query<any>(
    `SELECT party, bill::float8 AS bill, d90p::float8 AS d90p, tier, family, exec
       FROM "Account" WHERE bill > 0 ORDER BY bill DESC LIMIT 10`);
  for (const r of top.rows) {
    const stuck = r.d90p > 0 ? ` · ${fmt(r.d90p)} stuck >90d` : '';
    console.log(`  ${fmt(r.bill).padEnd(14)} ${r.party.slice(0, 38).padEnd(40)} tier=${r.tier} fam=${(r.family||'—').slice(0,18).padEnd(18)} ${r.exec || ''}${stuck}`);
  }
  const sumTop = top.rows.reduce((s: number, r: any) => s + r.bill, 0);
  console.log(`  -- Top 10 = ${fmt(sumTop)} (${pct(sumTop, a.total)} of net outstanding) --`);

  console.log('\n========== TOP 10 STUCK IN 90+ ==========');
  const stuck = await pool.query<any>(
    `SELECT party, bill::float8 AS bill, d90p::float8 AS d90p, tier, family, exec
       FROM "Account" WHERE d90p > 0 ORDER BY d90p DESC LIMIT 10`);
  for (const r of stuck.rows) {
    console.log(`  ${fmt(r.d90p).padEnd(14)} ${r.party.slice(0, 40).padEnd(42)} bill=${fmt(r.bill).padStart(11)} tier=${r.tier} ${r.exec || ''}`);
  }
  const sumStuck = stuck.rows.reduce((s: number, r: any) => s + r.d90p, 0);
  console.log(`  -- Top 10 stuck = ${fmt(sumStuck)} (${pct(sumStuck, a.d90p)} of all 90+) --`);

  console.log('\n========== FAMILY CONCENTRATION (top 12) ==========');
  const fams = await pool.query<any>(
    `SELECT family, COUNT(*)::int AS members, SUM(bill)::float8 AS total,
            SUM(d90p)::float8 AS stuck
       FROM "Account" WHERE family IS NOT NULL AND bill > 0
       GROUP BY family ORDER BY total DESC LIMIT 12`);
  for (const f of fams.rows) {
    console.log(`  ${(f.family||'').slice(0,28).padEnd(30)} ${f.members.toString().padStart(2)} members · ${fmt(f.total).padEnd(14)} · 90+ ${fmt(f.stuck)}`);
  }
  const cntFam = await pool.query<any>(`SELECT COUNT(DISTINCT family)::int AS n FROM "Account" WHERE family IS NOT NULL`);
  console.log(`  -- ${cntFam.rows[0].n} distinct families total --`);

  console.log('\n========== EXEC LOAD (all 33) ==========');
  const execs = await pool.query<any>(
    `SELECT exec, COUNT(*)::int AS n, SUM(bill)::float8 AS total,
            SUM(d90p)::float8 AS stuck,
            COUNT(*) FILTER (WHERE bill > 100000)::int AS big_accounts
       FROM "Account" WHERE exec IS NOT NULL AND bill > 0
       GROUP BY exec ORDER BY total DESC`);
  console.log(`  ${'EXEC'.padEnd(28)} ${'#OWE'.padStart(5)} ${'OUTSTANDING'.padStart(14)} ${'>90d STUCK'.padStart(14)}  >₹1L`);
  for (const e of execs.rows) {
    console.log(`  ${(e.exec||'').slice(0,28).padEnd(28)} ${e.n.toString().padStart(5)} ${fmt(e.total).padStart(14)} ${fmt(e.stuck).padStart(14)}  ${e.big_accounts}`);
  }
  const unassigned = await pool.query<any>(`SELECT COUNT(*)::int AS n, SUM(bill)::float8 AS t FROM "Account" WHERE (exec IS NULL OR exec = '') AND bill > 0`);
  if (unassigned.rows[0].n > 0) {
    console.log(`  ${'(no exec assigned)'.padEnd(28)} ${unassigned.rows[0].n.toString().padStart(5)} ${fmt(unassigned.rows[0].t).padStart(14)}  ← ORPHANED`);
  }

  console.log('\n========== BILL-SIZE DISTRIBUTION ==========');
  const buckets = await pool.query<any>(`
    SELECT
      COUNT(*) FILTER (WHERE bill > 0     AND bill <= 10000)::int   AS under_10k,
      COUNT(*) FILTER (WHERE bill > 10000 AND bill <= 50000)::int   AS k10_50k,
      COUNT(*) FILTER (WHERE bill > 50000 AND bill <= 100000)::int  AS k50_100k,
      COUNT(*) FILTER (WHERE bill > 100000 AND bill <= 500000)::int AS k100_500k,
      COUNT(*) FILTER (WHERE bill > 500000 AND bill <= 1000000)::int AS k5_10L,
      COUNT(*) FILTER (WHERE bill > 1000000)::int                   AS over_10L
      FROM "Account"`);
  const b = buckets.rows[0];
  console.log(`  ≤ ₹10k       : ${b.under_10k}`);
  console.log(`  ₹10k - ₹50k  : ${b.k10_50k}`);
  console.log(`  ₹50k - ₹1L   : ${b.k50_100k}`);
  console.log(`  ₹1L  - ₹5L   : ${b.k100_500k}`);
  console.log(`  ₹5L  - ₹10L  : ${b.k5_10L}`);
  console.log(`  > ₹10L       : ${b.over_10L}`);

  console.log('\n========== EMPTY FIELDS (data-quality) ==========');
  const dq = await pool.query<any>(`
    SELECT
      COUNT(*) FILTER (WHERE family IS NULL OR family = '')::int  AS no_family,
      COUNT(*) FILTER (WHERE exec IS NULL OR exec = '')::int      AS no_exec,
      COUNT(*) FILTER (WHERE cm IS NULL OR cm = '')::int          AS no_cm,
      COUNT(*) FILTER (WHERE branch IS NULL OR branch = '')::int  AS no_branch,
      COUNT(*) FILTER (WHERE "creditLimit" = 0)::int               AS no_limit,
      COUNT(*) FILTER (WHERE "creditPeriod" IS NULL OR "creditPeriod" = '')::int AS no_period
      FROM "Account" WHERE bill > 0`);
  const q = dq.rows[0];
  console.log(`  no family   : ${q.no_family}`);
  console.log(`  no exec     : ${q.no_exec}`);
  console.log(`  no CM       : ${q.no_cm}`);
  console.log(`  no branch   : ${q.no_branch}`);
  console.log(`  no credit limit set : ${q.no_limit}`);
  console.log(`  no credit period    : ${q.no_period}`);

  console.log('\n========== SIDE TABLES ==========');
  for (const [tbl, label] of [
    ['ClientMaster',   'Client master (contacts)'],
    ['Promise',        'Promises'],
    ['HoldRecord',     'Hold records'],
    ['PaymentPlan',    'Payment plans'],
    ['LegalCase',      'Legal cases'],
    ['CollectionLog',  'Collection log entries'],
    ['AccountHistory', 'Account history rows'],
    ['RefreshLog',     'Refresh log entries'],
  ] as const) {
    const r = await pool.query<any>(`SELECT COUNT(*)::int AS n FROM "${tbl}"`);
    console.log(`  ${label.padEnd(28)} ${r.rows[0].n}`);
  }

  console.log('\n========== STALE ACCOUNTS ==========');
  const stale = await pool.query<any>(`
    SELECT COUNT(*) FILTER (WHERE "lastTouched" < NOW() - INTERVAL '7 days')::int  AS gt7,
           COUNT(*) FILTER (WHERE "lastTouched" < NOW() - INTERVAL '30 days')::int AS gt30,
           COUNT(*) FILTER (WHERE "recentCall" IS NULL)::int AS never_called
      FROM "Account" WHERE bill > 0`);
  const s = stale.rows[0];
  console.log(`  Owing accounts not touched >7d   : ${s.gt7}`);
  console.log(`  Owing accounts not touched >30d  : ${s.gt30}`);
  console.log(`  Owing accounts NEVER called      : ${s.never_called}`);

  console.log('\n========== INTERESTING PATTERNS ==========');
  const tournaments = await pool.query<any>(
    `SELECT COUNT(*)::int AS n, SUM(bill)::float8 AS total
       FROM "Account" WHERE bill > 0 AND
         (party ILIKE 'aca %' OR party ILIKE '%trophy%' OR party ILIKE '%ranji%' OR party ILIKE '%cricket%')`);
  console.log(`  ACA / Trophy / Cricket-related accounts: ${tournaments.rows[0].n} totalling ${fmt(tournaments.rows[0].total)}`);
  const personal = await pool.query<any>(
    `SELECT COUNT(*)::int AS n, SUM(bill)::float8 AS total
       FROM "Account" WHERE bill > 0 AND (party ILIKE '%/personal%' OR party ILIKE '%personal' OR party ILIKE 'advance%')`);
  console.log(`  Personal / Advance accounts: ${personal.rows[0].n} totalling ${fmt(personal.rows[0].total)}`);
  const mla = await pool.query<any>(
    `SELECT COUNT(*)::int AS n, SUM(bill)::float8 AS total
       FROM "Account" WHERE bill > 0 AND (party ILIKE '%mla%' OR party ILIKE '%speaker%' OR party ILIKE '%minister%')`);
  console.log(`  MLA / Speaker / Minister accounts: ${mla.rows[0].n} totalling ${fmt(mla.rows[0].total)}`);
  const govt = await pool.query<any>(
    `SELECT COUNT(*)::int AS n, SUM(bill)::float8 AS total
       FROM "Account" WHERE bill > 0 AND (party ILIKE '%assam%' OR party ILIKE '%directorate%' OR party ILIKE '%govt%' OR party ILIKE '%government%')`);
  console.log(`  Govt-related accounts: ${govt.rows[0].n} totalling ${fmt(govt.rows[0].total)}`);

  await pool.end();
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
