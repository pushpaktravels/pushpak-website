// ============================================================
// POST /api/upload/commit — apply a FinBook upload to the DB.
// ============================================================
// Same parse pipeline as /api/upload/parse, but inside a single
// withTransaction it actually writes:
//   • Upsert every Account row (preserves tierOverride/alertOverride/
//     manual fields like history/mgtNote/stage/etc.)
//   • CollectionLog rows for detected payments
//   • AccountHistory entries describing each change (source = "Refresh")
//   • Promise rows marked Kept where outstanding dropped to/under the promised level
//   • New HoldRecord candidates
//   • Tier suggestions applied (only when no tierOverride is set)
//   • RefreshLog summary row
//   • Audit log entry
//
// Owner/Admin only. Atomic — if any single write throws, the whole
// refresh rolls back.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { query, withTransaction, newId } from '@/lib/pg';
import { readUploadedFile } from '@/lib/upload-multipart';
import { parseWorkbookBuffer } from '@/lib/upload-parser';
import { buildDiffPlan, type CurrentAccount, type OpenPromise } from '@/lib/upload-diff';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin')) return;

  let file;
  try {
    file = await readUploadedFile(req);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message || 'Bad upload' });
  }

  const parsed = parseWorkbookBuffer(file.buffer, { fileName: file.fileName });
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error, headers: parsed.headers, warnings: parsed.warnings });
  }

  const current = await query<CurrentAccount>(
    `SELECT party,
            COALESCE(bill,0)::float8 AS bill,
            COALESCE(d30,0)::float8  AS d30,
            COALESCE(d60,0)::float8  AS d60,
            COALESCE(d90,0)::float8  AS d90,
            COALESCE(d90p,0)::float8 AS d90p,
            exec, cm, family, branch,
            tier, "tierOverride", alert, "alertOverride",
            COALESCE("creditLimit",0)::float8 AS "creditLimit",
            "creditPeriod"
       FROM "Account"`
  );
  const openPromises = await query<OpenPromise>(
    `SELECT id, party, "outstandingAt"::float8 AS "outstandingAt"
       FROM "Promise"
      WHERE status = 'Open'`
  );

  const plan = buildDiffPlan(parsed.rows!, current, openPromises);
  const tierByParty = new Map(plan.tierSuggestions.map(t => [t.party.toUpperCase(), t.to]));

  try {
    await withTransaction(async (q) => {
      // ── 1. CREATE new accounts
      for (const p of plan.toCreate) {
        const id = newId('acc');
        const initialTier = tierByParty.get(p.party.toUpperCase()) || 'A';
        await q(
          `INSERT INTO "Account"
             (id, party, family, exec, cm, branch, tier,
              bill, d30, d60, d90, d90p,
              "creditLimit", "creditPeriod",
              "lastTouched", "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW(),NOW())`,
          [id, p.party, p.family, p.exec, p.cm, p.branch, initialTier,
           p.bill, p.d30, p.d60, p.d90, p.d90p, p.creditLimit, p.creditPeriod]
        );
        await q(
          `INSERT INTO "AccountHistory"
             (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, $3, $4, 'Account created', NULL, $5, $6, 'Refresh')`,
          [newId('hist'), p.party, p.exec, p.cm, `New from upload (${file.fileName})`, p.bill]
        );
      }

      // ── 2. UPDATE existing accounts
      for (const u of plan.toUpdate) {
        const a = u.after;
        const suggestedTier = tierByParty.get(u.party.toUpperCase());
        const sets: string[] = [
          `bill=$1`, `d30=$2`, `d60=$3`, `d90=$4`, `d90p=$5`,
          `"lastTouched"=NOW()`, `"updatedAt"=NOW()`,
        ];
        const params: any[] = [a.bill, a.d30, a.d60, a.d90, a.d90p];
        let i = 6;
        if (a.exec   != null && a.exec   !== u.before.exec)   { sets.push(`exec=$${i++}`);     params.push(a.exec); }
        if (a.cm     != null && a.cm     !== u.before.cm)     { sets.push(`cm=$${i++}`);       params.push(a.cm); }
        if (a.family != null && a.family !== u.before.family) { sets.push(`family=$${i++}`);   params.push(a.family); }
        if (a.branch != null && a.branch !== u.before.branch) { sets.push(`branch=$${i++}`);   params.push(a.branch); }
        if (a.creditLimit > 0 && a.creditLimit !== u.before.creditLimit) {
          sets.push(`"creditLimit"=$${i++}`); params.push(a.creditLimit);
        }
        if (a.creditPeriod && a.creditPeriod !== u.before.creditPeriod) {
          sets.push(`"creditPeriod"=$${i++}`); params.push(a.creditPeriod);
        }
        // Tier — only if no manual override
        if (suggestedTier && !u.before.tierOverride && suggestedTier !== u.before.tier) {
          sets.push(`tier=$${i++}`); params.push(suggestedTier);
        }

        params.push(u.party);
        await q(`UPDATE "Account" SET ${sets.join(', ')} WHERE party=$${i}`, params);

        // One history row per change so the Timeline tab tells the story.
        for (const ch of u.changes) {
          await q(
            `INSERT INTO "AccountHistory"
               (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
             VALUES ($1, NOW(), $2, $3, $4, 'Refresh', NULL, $5, $6, 'Refresh')`,
            [newId('hist'), u.party, a.exec ?? u.before.exec, a.cm ?? u.before.cm, ch, a.bill]
          );
        }
      }

      // ── 3. CLOSE accounts missing from file (set bill → 0)
      for (const c of plan.toClose) {
        await q(
          `UPDATE "Account"
              SET bill=0, d30=0, d60=0, d90=0, d90p=0,
                  "lastTouched"=NOW(), "updatedAt"=NOW()
            WHERE party=$1`,
          [c.party]
        );
        await q(
          `INSERT INTO "AccountHistory"
             (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, $3, $4, 'Balance cleared', $5, '₹0', 0, 'Refresh')`,
          [newId('hist'), c.party, c.before.exec, c.before.cm, `₹${Number(c.before.bill).toLocaleString('en-IN')}`]
        );
      }

      // ── 4. COLLECTION LOG
      for (const col of plan.collections) {
        await q(
          `INSERT INTO "CollectionLog"
             (id, date, party, family, exec, cm, amount, "prevOutstanding", "newOutstanding", trigger)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)`,
          [newId('coll'), col.party, col.family, col.exec, col.cm,
           col.amount, col.prevOutstanding, col.newOutstanding,
           `Refresh by ${user.execId}`]
        );
      }

      // ── 5. PROMISES KEPT
      for (const pk of plan.promisesKept) {
        await q(
          `UPDATE "Promise"
              SET status='Kept', "settledOn"=NOW()
            WHERE id=$1 AND status='Open'`,
          [pk.promiseId]
        );
        await q(
          `INSERT INTO "AccountHistory"
             (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, NULL, NULL, 'Promise kept', 'Open', 'Kept', $3, 'Refresh')`,
          [newId('hist'), pk.party, pk.outstandingNow]
        );
      }

      // ── 6. NEW HOLD CANDIDATES
      for (const h of plan.newHoldCandidates) {
        // Only flag if no Active/Candidate row already exists for this party
        const existing = await q(
          `SELECT id FROM "HoldRecord" WHERE party=$1 AND status IN ('Candidate','Active') LIMIT 1`,
          [h.party]
        );
        if (existing.length > 0) continue;
        await q(
          `INSERT INTO "HoldRecord"
             (id, party, outstanding, reason, status, "addedOn")
           VALUES ($1, $2, $3, $4, 'Candidate', NOW())`,
          [newId('hold'), h.party, h.outstanding, h.reason]
        );
        await q(
          `UPDATE "Account" SET alert='On Hold', "lastTouched"=NOW(), "updatedAt"=NOW()
            WHERE party=$1 AND ("alertOverride" IS NULL OR "alertOverride"='')`,
          [h.party]
        );
        await q(
          `INSERT INTO "AccountHistory"
             (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, NULL, NULL, 'Hold candidate', NULL, $3, $4, 'Refresh')`,
          [newId('hist'), h.party, h.reason, h.outstanding]
        );
      }

      // ── 7. REFRESH LOG row
      await q(
        `INSERT INTO "RefreshLog"
           (id, ts, "byWhom", "accountCount", "totalOutstanding", delta,
            "promisesKept", "promisesBroken", "newHoldCandidates", "newCollections", notes)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, 0, $7, $8, $9)`,
        [
          newId('rfr'), user.execId, plan.summary.finalAccounts,
          plan.summary.totalOutstanding, plan.summary.delta,
          plan.promisesKept.length, plan.newHoldCandidates.length,
          plan.collections.length,
          `Upload: ${file.fileName} (${plan.summary.fileRows} rows)`,
        ]
      );
    });

    audit(req, user, 'UPLOAD_COMMIT', file.fileName, plan.summary);

    return res.json({
      ok: true,
      summary: plan.summary,
      file: { name: file.fileName, size: file.size },
    });
  } catch (err: any) {
    console.error('[api/upload/commit] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Refresh failed' });
  }
}
