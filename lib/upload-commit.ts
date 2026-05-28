// ============================================================
// upload-commit.ts — batched SQL writers for refresh commits.
// ============================================================
// Replaces the per-row INSERT/UPDATE pattern with bulk UNNEST-based
// SQL so a 350-account refresh runs in ~1 round-trip per table
// instead of ~700+. This is the single biggest speed win: at
// Supabase's ~150 ms per query, batching cuts a 5-minute refresh to
// under 2 seconds.
//
// Each applyXxxPlan() takes the corresponding diff plan and a
// transaction client (the `q` callback handed to withTransaction)
// and runs all writes for that report type. They can be chained
// inside one withTransaction so the whole 3-file refresh is atomic.
// ============================================================
import { newId } from './pg';
import type { AgewisePlan, ClientwisePlan, FamilywisePlan } from './upload-diff';

type Q = (sql: string, params?: any[]) => Promise<any[]>;

// ─── Bulk INSERT helper ────────────────────────────────────────
// Builds a single INSERT … SELECT FROM UNNEST(...) query that
// inserts every row of `rows` in one round-trip. Optionally takes an
// `onConflict` clause so callers can do upsert-style writes when two
// passes might insert the same row (e.g. familywise + clientwise both
// creating a party that wasn't in the snapshot).
async function bulkInsert(
  q: Q,
  table: string,
  rows: any[],
  columns: Array<{ name: string; type: string; get: (r: any) => any }>,
  literals: Array<{ name: string; expr: string }> = [],
  onConflict: string = ''
) {
  if (rows.length === 0) return;
  const arrays = columns.map(c => rows.map(c.get));
  const placeholders = columns.map((c, i) => `$${i + 1}::${c.type}[]`).join(', ');
  const colAliases   = columns.map((_, i) => `c${i + 1}`).join(', ');
  const selectCols   = [...columns.map((_, i) => `c${i + 1}`), ...literals.map(l => l.expr)].join(', ');
  const allColNames  = [...columns.map(c => `"${c.name}"`), ...literals.map(l => `"${l.name}"`)].join(', ');
  const sql = `
    INSERT INTO "${table}" (${allColNames})
    SELECT ${selectCols}
      FROM UNNEST(${placeholders}) AS t(${colAliases})
    ${onConflict}
  `;
  await q(sql, arrays);
}

// Wrapper that emits AccountHistory rows in one shot.
async function bulkHistory(
  q: Q,
  rows: Array<{ party: string; action: string; oldValue?: string | null; newValue?: string | null; outstanding?: number | null; exec?: string | null; cm?: string | null }>
) {
  if (rows.length === 0) return;
  await bulkInsert(
    q, 'AccountHistory', rows,
    [
      { name: 'id',         type: 'text',    get: () => newId('hist') },
      { name: 'party',      type: 'text',    get: r => r.party },
      { name: 'exec',       type: 'text',    get: r => r.exec ?? null },
      { name: 'cm',         type: 'text',    get: r => r.cm ?? null },
      { name: 'action',     type: 'text',    get: r => r.action },
      { name: 'oldValue',   type: 'text',    get: r => r.oldValue ?? null },
      { name: 'newValue',   type: 'text',    get: r => r.newValue ?? null },
      { name: 'outstanding',type: 'numeric', get: r => r.outstanding ?? null },
      { name: 'source',     type: 'text',    get: () => 'Refresh' },
    ],
    [{ name: 'ts', expr: 'NOW()' }]
  );
}

// ─── AGEWISE ───────────────────────────────────────────────────
export async function applyAgewisePlan(q: Q, plan: AgewisePlan, opts: { fileName: string; userExecId: string }) {
  const tierByParty = new Map(plan.tierSuggestions.map(t => [t.party.toUpperCase(), t.to]));
  const history: Parameters<typeof bulkHistory>[1] = [];

  // 1) Bulk CREATE (with ON CONFLICT in case a prior pass in the same
  // transaction — familywise / clientwise — already created the row)
  if (plan.toCreate.length > 0) {
    const creates = plan.toCreate.map(p => ({
      ...p,
      tier: tierByParty.get(p.party.toUpperCase()) || 'A',
    }));
    await bulkInsert(q, 'Account', creates,
      [
        { name: 'id',    type: 'text',    get: () => newId('acc') },
        { name: 'party', type: 'text',    get: r => r.party },
        { name: 'tier',  type: 'text',    get: r => r.tier },
        { name: 'bill',  type: 'numeric', get: r => r.bill },
        { name: 'd30',   type: 'numeric', get: r => r.d30 },
        { name: 'd60',   type: 'numeric', get: r => r.d60 },
        { name: 'd90',   type: 'numeric', get: r => r.d90 },
        { name: 'd90p',  type: 'numeric', get: r => r.d90p },
      ],
      [
        { name: 'lastTouched', expr: 'NOW()' },
        { name: 'createdAt',   expr: 'NOW()' },
        { name: 'updatedAt',   expr: 'NOW()' },
      ],
      `ON CONFLICT (party) DO UPDATE SET
         bill = EXCLUDED.bill,
         d30  = EXCLUDED.d30,
         d60  = EXCLUDED.d60,
         d90  = EXCLUDED.d90,
         d90p = EXCLUDED.d90p,
         "lastTouched" = NOW(),
         "updatedAt"   = NOW()`
    );
    for (const p of plan.toCreate) {
      history.push({ party: p.party, action: 'Account created', newValue: `Agewise upload (${opts.fileName})`, outstanding: p.bill });
    }
  }

  // 2) Bulk UPDATE financials (via UPDATE … FROM UNNEST)
  if (plan.toUpdate.length > 0) {
    const u = plan.toUpdate;
    const parties = u.map(x => x.party);
    const bills   = u.map(x => x.after.bill);
    const d30s    = u.map(x => x.after.d30);
    const d60s    = u.map(x => x.after.d60);
    const d90s    = u.map(x => x.after.d90);
    const d90ps   = u.map(x => x.after.d90p);
    const tiers   = u.map(x => {
      const s = tierByParty.get(x.party.toUpperCase());
      if (s && !x.before.tierOverride && s !== x.before.tier) return s;
      return null;
    });
    await q(
      `UPDATE "Account" AS a SET
         bill          = u.bill::numeric,
         d30           = u.d30::numeric,
         d60           = u.d60::numeric,
         d90           = u.d90::numeric,
         d90p          = u.d90p::numeric,
         tier          = COALESCE(u.tier, a.tier),
         "lastTouched" = NOW(),
         "updatedAt"   = NOW()
       FROM UNNEST(
         $1::text[], $2::numeric[], $3::numeric[], $4::numeric[],
         $5::numeric[], $6::numeric[], $7::text[]
       ) AS u(party, bill, d30, d60, d90, d90p, tier)
       WHERE a.party = u.party`,
      [parties, bills, d30s, d60s, d90s, d90ps, tiers]
    );
    for (const x of u) {
      for (const ch of x.changes) {
        history.push({ party: x.party, action: 'Refresh', newValue: ch, outstanding: x.after.bill, exec: x.before.exec, cm: x.before.cm });
      }
    }
  }

  // 3) Bulk CLEAR (parties missing from file)
  if (plan.toClose.length > 0) {
    const parties = plan.toClose.map(c => c.party);
    await q(
      `UPDATE "Account" AS a SET
         bill=0, d30=0, d60=0, d90=0, d90p=0,
         "lastTouched"=NOW(), "updatedAt"=NOW()
       FROM UNNEST($1::text[]) AS u(party)
       WHERE a.party = u.party`,
      [parties]
    );
    for (const c of plan.toClose) {
      history.push({
        party: c.party, action: 'Balance cleared',
        oldValue: `₹${Number(c.before.bill).toLocaleString('en-IN')}`,
        newValue: '₹0', outstanding: 0, exec: c.before.exec, cm: c.before.cm,
      });
    }
  }

  // 4) Bulk CollectionLog
  if (plan.collections.length > 0) {
    await bulkInsert(q, 'CollectionLog', plan.collections,
      [
        { name: 'id',              type: 'text',    get: () => newId('coll') },
        { name: 'party',           type: 'text',    get: r => r.party },
        { name: 'family',          type: 'text',    get: r => r.family },
        { name: 'exec',            type: 'text',    get: r => r.exec },
        { name: 'cm',              type: 'text',    get: r => r.cm },
        { name: 'amount',          type: 'numeric', get: r => r.amount },
        { name: 'prevOutstanding', type: 'numeric', get: r => r.prevOutstanding },
        { name: 'newOutstanding',  type: 'numeric', get: r => r.newOutstanding },
        { name: 'trigger',         type: 'text',    get: () => `Refresh by ${opts.userExecId}` },
      ],
      [{ name: 'date', expr: 'NOW()' }]
    );
  }

  // 5) Bulk PROMISES KEPT
  if (plan.promisesKept.length > 0) {
    await q(
      `UPDATE "Promise" AS p SET status='Kept', "settledOn"=NOW()
         FROM UNNEST($1::text[]) AS u(id)
        WHERE p.id = u.id AND p.status = 'Open'`,
      [plan.promisesKept.map(pk => pk.promiseId)]
    );
    for (const pk of plan.promisesKept) {
      history.push({ party: pk.party, action: 'Promise kept', oldValue: 'Open', newValue: 'Kept', outstanding: pk.outstandingNow });
    }
  }

  // 6) HOLD candidates — one SELECT to find which parties already have an open hold, then bulk INSERT the rest
  if (plan.newHoldCandidates.length > 0) {
    const candidateParties = plan.newHoldCandidates.map(h => h.party);
    const existing = await q(
      `SELECT party FROM "HoldRecord" WHERE status IN ('Candidate','Active') AND party = ANY($1::text[])`,
      [candidateParties]
    );
    const skip = new Set<string>(existing.map((e: any) => String(e.party).toUpperCase()));
    const fresh = plan.newHoldCandidates.filter(h => !skip.has(h.party.toUpperCase()));
    if (fresh.length > 0) {
      await bulkInsert(q, 'HoldRecord', fresh,
        [
          { name: 'id',          type: 'text',    get: () => newId('hold') },
          { name: 'party',       type: 'text',    get: r => r.party },
          { name: 'outstanding', type: 'numeric', get: r => r.outstanding },
          { name: 'reason',      type: 'text',    get: r => r.reason },
          { name: 'status',      type: 'text',    get: () => 'Candidate' },
        ],
        [{ name: 'addedOn', expr: 'NOW()' }]
      );
      // Flag the alert (skip rows with alertOverride set)
      await q(
        `UPDATE "Account" AS a SET alert='On Hold', "lastTouched"=NOW(), "updatedAt"=NOW()
           FROM UNNEST($1::text[]) AS u(party)
          WHERE a.party = u.party AND (a."alertOverride" IS NULL OR a."alertOverride" = '')`,
        [fresh.map(h => h.party)]
      );
      for (const h of fresh) {
        history.push({ party: h.party, action: 'Hold candidate', newValue: h.reason, outstanding: h.outstanding });
      }
    }
  }

  // 7) Flush history in one shot
  await bulkHistory(q, history);

  // 8) RefreshLog
  await q(
    `INSERT INTO "RefreshLog"
       (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
        "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, 0, $7, $8, $9)`,
    [
      newId('rfr'), opts.userExecId, plan.summary.finalAccounts,
      plan.summary.totalOutstanding, plan.summary.delta,
      plan.promisesKept.length, plan.newHoldCandidates.length,
      plan.collections.length, `Agewise upload: ${opts.fileName} (${plan.summary.fileRows} rows)`,
    ]
  );
}

// ─── CLIENTWISE ────────────────────────────────────────────────
export async function applyClientwisePlan(q: Q, plan: ClientwisePlan, opts: { fileName: string; userExecId: string }) {
  const history: Parameters<typeof bulkHistory>[1] = [];

  if (plan.toCreate.length > 0) {
    await bulkInsert(q, 'Account', plan.toCreate,
      [
        { name: 'id',    type: 'text',    get: () => newId('acc') },
        { name: 'party', type: 'text',    get: r => r.party },
        { name: 'tier',  type: 'text',    get: () => 'A' },
        { name: 'bill',  type: 'numeric', get: r => r.balance },
        { name: 'exec',  type: 'text',    get: r => r.exec },
      ],
      [
        { name: 'lastTouched', expr: 'NOW()' },
        { name: 'createdAt',   expr: 'NOW()' },
        { name: 'updatedAt',   expr: 'NOW()' },
      ],
      `ON CONFLICT (party) DO UPDATE SET
         exec = EXCLUDED.exec,
         "lastTouched" = NOW(),
         "updatedAt"   = NOW()`
    );
    for (const c of plan.toCreate) {
      history.push({
        party: c.party, action: 'Account created',
        newValue: `Clientwise upload (${opts.fileName})`,
        outstanding: c.balance, exec: c.exec,
      });
    }
  }

  if (plan.toUpdate.length > 0) {
    // Skip when execOverride is set — preserves any manual reassignment
    // made through the portal.
    await q(
      `UPDATE "Account" AS a SET exec=u.exec, "lastTouched"=NOW(), "updatedAt"=NOW()
         FROM UNNEST($1::text[], $2::text[]) AS u(party, exec)
        WHERE a.party = u.party
          AND (a."execOverride" IS NULL OR a."execOverride" = '')`,
      [plan.toUpdate.map(u => u.party), plan.toUpdate.map(u => u.after)]
    );
    for (const u of plan.toUpdate) {
      history.push({ party: u.party, action: 'Exec reassigned', oldValue: u.before, newValue: u.after });
    }
  }

  await bulkHistory(q, history);

  await q(
    `INSERT INTO "RefreshLog"
       (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
        "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
     VALUES ($1, NOW(), $2, $3, 0, 0, 0, 0, 0, 0, $4)`,
    [
      newId('rfr'), opts.userExecId, plan.summary.fileRows,
      `Clientwise upload: ${opts.fileName} — ${plan.summary.createCount} created, ${plan.summary.updateCount} reassigned, ${plan.summary.distinctExecs} distinct execs`,
    ]
  );
}

// ─── FAMILYWISE ────────────────────────────────────────────────
export async function applyFamilywisePlan(q: Q, plan: FamilywisePlan, opts: { fileName: string; userExecId: string }) {
  const history: Parameters<typeof bulkHistory>[1] = [];

  if (plan.toCreate.length > 0) {
    await bulkInsert(q, 'Account', plan.toCreate,
      [
        { name: 'id',     type: 'text',    get: () => newId('acc') },
        { name: 'party',  type: 'text',    get: r => r.party },
        { name: 'tier',   type: 'text',    get: () => 'A' },
        { name: 'bill',   type: 'numeric', get: r => r.balance },
        { name: 'family', type: 'text',    get: r => r.family },
      ],
      [
        { name: 'lastTouched', expr: 'NOW()' },
        { name: 'createdAt',   expr: 'NOW()' },
        { name: 'updatedAt',   expr: 'NOW()' },
      ],
      `ON CONFLICT (party) DO UPDATE SET
         family = EXCLUDED.family,
         "lastTouched" = NOW(),
         "updatedAt"   = NOW()`
    );
    for (const c of plan.toCreate) {
      history.push({
        party: c.party, action: 'Account created',
        newValue: `Familywise upload (${opts.fileName})`,
        outstanding: c.balance,
      });
    }
  }

  if (plan.toUpdate.length > 0) {
    // Skip when familyOverride is set — preserves manual family
    // reassignment made through the portal.
    await q(
      `UPDATE "Account" AS a SET family=u.family, "lastTouched"=NOW(), "updatedAt"=NOW()
         FROM UNNEST($1::text[], $2::text[]) AS u(party, family)
        WHERE a.party = u.party
          AND (a."familyOverride" IS NULL OR a."familyOverride" = '')`,
      [plan.toUpdate.map(u => u.party), plan.toUpdate.map(u => u.after)]
    );
    for (const u of plan.toUpdate) {
      history.push({ party: u.party, action: 'Family reassigned', oldValue: u.before, newValue: u.after });
    }
  }

  await bulkHistory(q, history);

  await q(
    `INSERT INTO "RefreshLog"
       (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
        "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
     VALUES ($1, NOW(), $2, $3, 0, 0, 0, 0, 0, 0, $4)`,
    [
      newId('rfr'), opts.userExecId, plan.summary.fileRows,
      `Familywise upload: ${opts.fileName} — ${plan.summary.createCount} created, ${plan.summary.updateCount} reassigned, ${plan.summary.distinctFamilies} distinct families`,
    ]
  );
}

// ─── CUSTOMER MASTER ──────────────────────────────────────────
// Upserts ClientMaster rows from a customer-master refresh. Each
// new row is INSERTed; existing rows get UPDATEd field-by-field so
// non-empty incoming values overwrite stale ones (the file is the
// source of truth) but empty incoming values DON'T wipe whatever
// data is already there.
export async function applyCustomerMasterPlan(
  q: Q,
  plan: import('./upload-diff').CustomerMasterPlan,
  opts: { fileName: string; userExecId: string }
) {
  const history: Parameters<typeof bulkHistory>[1] = [];

  // 1) CREATE — new ClientMaster rows
  if (plan.toCreate.length > 0) {
    await bulkInsert(q, 'ClientMaster', plan.toCreate,
      [
        { name: 'id',          type: 'text',    get: () => newId('cm') },
        { name: 'party',       type: 'text',    get: r => r.party },
        { name: 'phone1',      type: 'text',    get: r => r.phone1 },
        { name: 'phone2',      type: 'text',    get: r => r.phone2 },
        { name: 'whatsapp',    type: 'text',    get: r => r.whatsapp },
        { name: 'email',       type: 'text',    get: r => r.email },
        { name: 'owner',       type: 'text',    get: r => r.owner },
        { name: 'address',     type: 'text',    get: r => r.address },
        { name: 'creditLimit', type: 'numeric', get: r => r.creditLimit },
        { name: 'creditTerms', type: 'integer', get: r => r.creditTerms },
        { name: 'vip',         type: 'text',    get: r => r.vip },
        { name: 'segment',     type: 'text',    get: r => r.segment },
        { name: 'notes',       type: 'text',    get: r => r.notes },
      ],
      [
        { name: 'updatedAt', expr: 'NOW()' },
      ],
      // If a row gets created for the same party by a parallel pass
      // (unlikely but defensive), upsert the non-null fields.
      `ON CONFLICT (party) DO UPDATE SET
         phone1      = COALESCE(EXCLUDED.phone1,   "ClientMaster".phone1),
         phone2      = COALESCE(EXCLUDED.phone2,   "ClientMaster".phone2),
         whatsapp    = COALESCE(EXCLUDED.whatsapp, "ClientMaster".whatsapp),
         email       = COALESCE(EXCLUDED.email,    "ClientMaster".email),
         owner       = COALESCE(EXCLUDED.owner,    "ClientMaster".owner),
         address     = COALESCE(EXCLUDED.address,  "ClientMaster".address),
         "creditLimit" = GREATEST(EXCLUDED."creditLimit", "ClientMaster"."creditLimit"),
         "creditTerms" = GREATEST(EXCLUDED."creditTerms", "ClientMaster"."creditTerms"),
         vip         = COALESCE(EXCLUDED.vip,      "ClientMaster".vip),
         segment     = COALESCE(EXCLUDED.segment,  "ClientMaster".segment),
         notes       = COALESCE(EXCLUDED.notes,    "ClientMaster".notes),
         "updatedAt" = NOW()`
    );
    for (const c of plan.toCreate) {
      history.push({
        party: c.party, action: 'Contact details added',
        newValue: `Customer Master upload (${opts.fileName})`,
      });
    }
  }

  // 2) UPDATE existing ClientMaster rows. We do one UPDATE per row
  // because the SET clause depends on which fields are non-empty —
  // batching with UNNEST while preserving "don't wipe if empty"
  // semantics would need a CASE per column. With typically < 500
  // rows that change, sequential is fast enough.
  for (const u of plan.toUpdate) {
    const a = u.after;
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (a.phone1)   { sets.push(`phone1=$${i++}`);      params.push(a.phone1); }
    if (a.phone2)   { sets.push(`phone2=$${i++}`);      params.push(a.phone2); }
    if (a.whatsapp) { sets.push(`whatsapp=$${i++}`);    params.push(a.whatsapp); }
    if (a.email)    { sets.push(`email=$${i++}`);       params.push(a.email); }
    if (a.owner)    { sets.push(`owner=$${i++}`);       params.push(a.owner); }
    if (a.address)  { sets.push(`address=$${i++}`);     params.push(a.address); }
    if (a.creditLimit > 0) { sets.push(`"creditLimit"=$${i++}`); params.push(a.creditLimit); }
    if (a.creditTerms > 0) { sets.push(`"creditTerms"=$${i++}`); params.push(a.creditTerms); }
    if (a.vip)      { sets.push(`vip=$${i++}`);         params.push(a.vip); }
    if (a.segment)  { sets.push(`segment=$${i++}`);     params.push(a.segment); }
    if (a.notes)    { sets.push(`notes=$${i++}`);       params.push(a.notes); }
    if (sets.length === 0) continue;
    sets.push(`"updatedAt"=NOW()`);
    params.push(u.party);
    await q(`UPDATE "ClientMaster" SET ${sets.join(', ')} WHERE party=$${i}`, params);
    history.push({
      party: u.party, action: 'Contact details refreshed',
      newValue: u.changes.slice(0, 3).join(' · ') + (u.changes.length > 3 ? ` +${u.changes.length - 3}` : ''),
    });
  }

  await bulkHistory(q, history);

  await q(
    `INSERT INTO "RefreshLog"
       (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
        "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
     VALUES ($1, NOW(), $2, $3, 0, 0, 0, 0, 0, 0, $4)`,
    [
      newId('rfr'), opts.userExecId, plan.summary.fileRows,
      `Customer Master upload: ${opts.fileName} — ${plan.summary.createCount} added, ${plan.summary.updateCount} updated, ${plan.summary.withPhone} with phone, ${plan.summary.withEmail} with email`,
    ]
  );
}
