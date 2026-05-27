// ============================================================
// POST /api/upload/commit — apply a FinBook upload to the DB.
// ============================================================
// Same parse + diff pipeline as /api/upload/parse, but inside a
// withTransaction it actually writes. Switches on reportType:
//
//   agewise     → upsert Account financials, log Collections,
//                 mark Promises Kept, raise Hold candidates,
//                 apply tier suggestions, RefreshLog entry,
//                 clear missing parties (bill=0).
//   clientwise  → update Account.exec for matching parties,
//                 create missing parties with bill=balance,
//                 RefreshLog entry.
//   familywise  → update Account.family for matching parties,
//                 create missing parties with bill=balance,
//                 RefreshLog entry.
//
// All three log per-change AccountHistory rows tagged source='Refresh'
// and append a Refresh log row + audit entry. Owner / Admin only.
// Atomic — any failure rolls the entire refresh back.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { query, withTransaction, newId } from '@/lib/pg';
import { readUploadedFile, readFieldString } from '@/lib/upload-multipart';
import { parseFinBook, type ReportType } from '@/lib/upload-parser';
import {
  buildAgewisePlan, buildClientwisePlan, buildFamilywisePlan,
  type CurrentAccount, type OpenPromise,
} from '@/lib/upload-diff';

export const config = { api: { bodyParser: false } };

const VALID: ReportType[] = ['agewise', 'clientwise', 'familywise'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  let file; let reportType: ReportType;
  try {
    const up = await readUploadedFile(req);
    file = up.file;
    reportType = (readFieldString(up.fields, 'reportType') || 'agewise') as ReportType;
    if (!VALID.includes(reportType)) {
      return res.status(400).json({ ok: false, error: `Invalid reportType: ${reportType}` });
    }
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message || 'Bad upload' });
  }

  const parsed = parseFinBook(file.buffer, reportType);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error, headers: parsed.headers, warnings: parsed.warnings });

  const current = await query<CurrentAccount>(
    `SELECT party,
            COALESCE(bill,0)::float8 AS bill,
            COALESCE(d30,0)::float8 AS d30, COALESCE(d60,0)::float8 AS d60,
            COALESCE(d90,0)::float8 AS d90, COALESCE(d90p,0)::float8 AS d90p,
            exec, cm, family, branch,
            tier, "tierOverride", alert, "alertOverride",
            COALESCE("creditLimit",0)::float8 AS "creditLimit",
            "creditPeriod"
       FROM "Account"`
  );

  try {
    if (parsed.type === 'agewise') {
      const summary = await commitAgewise(parsed.rows, current, file.fileName, user);
      audit(req, user, 'UPLOAD_COMMIT_AGEWISE', file.fileName, summary);
      return res.json({ ok: true, reportType: 'agewise', summary, file: { name: file.fileName, size: file.size } });
    }
    if (parsed.type === 'clientwise') {
      const summary = await commitClientwise(parsed.rows, current, file.fileName, user);
      audit(req, user, 'UPLOAD_COMMIT_CLIENTWISE', file.fileName, summary);
      return res.json({ ok: true, reportType: 'clientwise', summary, file: { name: file.fileName, size: file.size } });
    }
    // familywise
    const summary = await commitFamilywise(parsed.rows, current, file.fileName, user);
    audit(req, user, 'UPLOAD_COMMIT_FAMILYWISE', file.fileName, summary);
    return res.json({ ok: true, reportType: 'familywise', summary, file: { name: file.fileName, size: file.size } });
  } catch (err: any) {
    console.error('[api/upload/commit] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Refresh failed' });
  }
}

// ─── AGEWISE commit ────────────────────────────────────────────
async function commitAgewise(rows: any[], current: CurrentAccount[], fileName: string, user: any) {
  const openPromises = await query<OpenPromise>(
    `SELECT id, party, "outstandingAt"::float8 AS "outstandingAt" FROM "Promise" WHERE status = 'Open'`
  );
  const plan = buildAgewisePlan(rows, current, openPromises);
  const tierByParty = new Map(plan.tierSuggestions.map(t => [t.party.toUpperCase(), t.to]));

  await withTransaction(async (q) => {
    // 1) CREATE
    for (const p of plan.toCreate) {
      const id = newId('acc');
      const initialTier = tierByParty.get(p.party.toUpperCase()) || 'A';
      await q(
        `INSERT INTO "Account"
           (id, party, tier, bill, d30, d60, d90, d90p,
            "lastTouched", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW(), NOW(), NOW())`,
        [id, p.party, initialTier, p.bill, p.d30, p.d60, p.d90, p.d90p]
      );
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, 'Account created', $3, $4, 'Refresh')`,
        [newId('hist'), p.party, `New from upload (${fileName})`, p.bill]
      );
    }
    // 2) UPDATE
    for (const u of plan.toUpdate) {
      const a = u.after;
      const sug = tierByParty.get(u.party.toUpperCase());
      const sets = [`bill=$1`, `d30=$2`, `d60=$3`, `d90=$4`, `d90p=$5`, `"lastTouched"=NOW()`, `"updatedAt"=NOW()`];
      const params: any[] = [a.bill, a.d30, a.d60, a.d90, a.d90p];
      let i = 6;
      if (sug && !u.before.tierOverride && sug !== u.before.tier) {
        sets.push(`tier=$${i++}`); params.push(sug);
      }
      params.push(u.party);
      await q(`UPDATE "Account" SET ${sets.join(', ')} WHERE party=$${i}`, params);
      for (const ch of u.changes) {
        await q(
          `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, $3, $4, 'Refresh', $5, $6, 'Refresh')`,
          [newId('hist'), u.party, u.before.exec, u.before.cm, ch, a.bill]
        );
      }
    }
    // 3) CLOSE
    for (const c of plan.toClose) {
      await q(
        `UPDATE "Account" SET bill=0, d30=0, d60=0, d90=0, d90p=0,
                "lastTouched"=NOW(), "updatedAt"=NOW() WHERE party=$1`, [c.party]
      );
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, $3, $4, 'Balance cleared', $5, '₹0', 0, 'Refresh')`,
        [newId('hist'), c.party, c.before.exec, c.before.cm, `₹${Number(c.before.bill).toLocaleString('en-IN')}`]
      );
    }
    // 4) COLLECTIONS
    for (const col of plan.collections) {
      await q(
        `INSERT INTO "CollectionLog"
           (id, date, party, family, exec, cm, amount, "prevOutstanding", "newOutstanding", trigger)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newId('coll'), col.party, col.family, col.exec, col.cm, col.amount, col.prevOutstanding, col.newOutstanding, `Refresh by ${user.execId}`]
      );
    }
    // 5) PROMISES KEPT
    for (const pk of plan.promisesKept) {
      await q(`UPDATE "Promise" SET status='Kept', "settledOn"=NOW() WHERE id=$1 AND status='Open'`, [pk.promiseId]);
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, action, "oldValue", "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, 'Promise kept', 'Open', 'Kept', $3, 'Refresh')`,
        [newId('hist'), pk.party, pk.outstandingNow]
      );
    }
    // 6) HOLD CANDIDATES
    for (const h of plan.newHoldCandidates) {
      const ex = await q(`SELECT id FROM "HoldRecord" WHERE party=$1 AND status IN ('Candidate','Active') LIMIT 1`, [h.party]);
      if (ex.length > 0) continue;
      await q(
        `INSERT INTO "HoldRecord" (id, party, outstanding, reason, status, "addedOn")
         VALUES ($1, $2, $3, $4, 'Candidate', NOW())`,
        [newId('hold'), h.party, h.outstanding, h.reason]
      );
      await q(
        `UPDATE "Account" SET alert='On Hold', "lastTouched"=NOW(), "updatedAt"=NOW()
           WHERE party=$1 AND ("alertOverride" IS NULL OR "alertOverride"='')`,
        [h.party]
      );
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, 'Hold candidate', $3, $4, 'Refresh')`,
        [newId('hist'), h.party, h.reason, h.outstanding]
      );
    }
    // 7) REFRESH LOG
    await q(
      `INSERT INTO "RefreshLog"
         (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
          "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, 0, $7, $8, $9)`,
      [newId('rfr'), user.execId, plan.summary.finalAccounts,
       plan.summary.totalOutstanding, plan.summary.delta,
       plan.promisesKept.length, plan.newHoldCandidates.length,
       plan.collections.length, `Agewise upload: ${fileName} (${plan.summary.fileRows} rows)`]
    );
  });
  return plan.summary;
}

// ─── CLIENTWISE commit (exec assignment) ───────────────────────
async function commitClientwise(rows: any[], current: CurrentAccount[], fileName: string, user: any) {
  const plan = buildClientwisePlan(rows, current);
  await withTransaction(async (q) => {
    for (const c of plan.toCreate) {
      const id = newId('acc');
      await q(
        `INSERT INTO "Account" (id, party, tier, bill, exec, "lastTouched", "createdAt", "updatedAt")
         VALUES ($1, $2, 'A', $3, $4, NOW(), NOW(), NOW())`,
        [id, c.party, c.balance, c.exec]
      );
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, $3, 'Account created', $4, $5, 'Refresh')`,
        [newId('hist'), c.party, c.exec, `Clientwise upload (${fileName})`, c.balance]
      );
    }
    for (const u of plan.toUpdate) {
      await q(`UPDATE "Account" SET exec=$1, "lastTouched"=NOW(), "updatedAt"=NOW() WHERE party=$2`, [u.after, u.party]);
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, action, "oldValue", "newValue", source)
         VALUES ($1, NOW(), $2, 'Exec reassigned', $3, $4, 'Refresh')`,
        [newId('hist'), u.party, u.before, u.after]
      );
    }
    await q(
      `INSERT INTO "RefreshLog"
         (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
          "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
       VALUES ($1, NOW(), $2, $3, 0, 0, 0, 0, 0, 0, $4)`,
      [newId('rfr'), user.execId, plan.summary.fileRows,
       `Clientwise upload: ${fileName} — ${plan.summary.createCount} created, ${plan.summary.updateCount} exec reassigned, ${plan.summary.distinctExecs} distinct execs`]
    );
  });
  return plan.summary;
}

// ─── FAMILYWISE commit (family assignment) ─────────────────────
async function commitFamilywise(rows: any[], current: CurrentAccount[], fileName: string, user: any) {
  const plan = buildFamilywisePlan(rows, current);
  await withTransaction(async (q) => {
    for (const c of plan.toCreate) {
      const id = newId('acc');
      await q(
        `INSERT INTO "Account" (id, party, tier, bill, family, "lastTouched", "createdAt", "updatedAt")
         VALUES ($1, $2, 'A', $3, $4, NOW(), NOW(), NOW())`,
        [id, c.party, c.balance, c.family]
      );
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, 'Account created', $3, $4, 'Refresh')`,
        [newId('hist'), c.party, `Familywise upload (${fileName})`, c.balance]
      );
    }
    for (const u of plan.toUpdate) {
      await q(`UPDATE "Account" SET family=$1, "lastTouched"=NOW(), "updatedAt"=NOW() WHERE party=$2`, [u.after, u.party]);
      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, action, "oldValue", "newValue", source)
         VALUES ($1, NOW(), $2, 'Family reassigned', $3, $4, 'Refresh')`,
        [newId('hist'), u.party, u.before, u.after]
      );
    }
    await q(
      `INSERT INTO "RefreshLog"
         (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
          "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
       VALUES ($1, NOW(), $2, $3, 0, 0, 0, 0, 0, 0, $4)`,
      [newId('rfr'), user.execId, plan.summary.fileRows,
       `Familywise upload: ${fileName} — ${plan.summary.createCount} created, ${plan.summary.updateCount} family reassigned, ${plan.summary.distinctFamilies} distinct families`]
    );
  });
  return plan.summary;
}
