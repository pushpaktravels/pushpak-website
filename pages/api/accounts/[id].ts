// ============================================================
// /api/accounts/[id]
// ============================================================
// GET  — full account detail for the drawer:
//          account, client (ClientMaster), promises, holds, history
//
// PATCH — update individual fields on an account. Body keys that
//          are present get applied; everything else stays as-is.
//          Allowed fields: tier, alert, stage, status, mgtNote,
//          nextFu, history (freeform text), creditLimit,
//          creditPeriod, onTimePct.
//          Every change is logged to AccountHistory with the
//          before/after pair so the Timeline tab reflects it.
//
// Authorisation: visibleExecNames (CMs see their team only, etc.).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { audit } from '@/lib/audit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  if (req.method === 'GET') return handleGet(req, res, user, id);
  if (req.method === 'PATCH') return handlePatch(req, res, user, id);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

// ─── GET — drawer payload ─────────────────────────────────────
async function handleGet(req: NextApiRequest, res: NextApiResponse, user: any, id: string) {
  try {
    const account = await queryOne<any>(`SELECT * FROM "Account" WHERE id = $1 LIMIT 1`, [id]);
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

    const visible = visibleExecNames(user);
    if (visible !== null) {
      const execUpper = (account.exec || '').toUpperCase();
      if (!visible.has(execUpper)) {
        return res.status(403).json({ ok: false, error: 'Not allowed for your role' });
      }
    }

    const [client, promises, holds, history, paymentPlans, legalCase] = await Promise.all([
      queryOne<any>(`SELECT * FROM "ClientMaster" WHERE party = $1 LIMIT 1`, [account.party]),
      query<any>(
        `SELECT * FROM "Promise" WHERE party = $1 ORDER BY "expectedBy" DESC LIMIT 50`,
        [account.party]
      ),
      query<any>(
        `SELECT * FROM "HoldRecord" WHERE party = $1 ORDER BY "addedOn" DESC LIMIT 20`,
        [account.party]
      ),
      query<any>(
        `SELECT * FROM "AccountHistory" WHERE party = $1 ORDER BY ts DESC LIMIT 100`,
        [account.party]
      ),
      // Doubtful: pull the active payment plan if any
      query<any>(
        `SELECT * FROM "PaymentPlan" WHERE party = $1 AND "cancelledAt" IS NULL
         ORDER BY "createdAt" DESC LIMIT 1`,
        [account.party]
      ),
      // Legal: pull the active legal case if any
      queryOne<any>(
        `SELECT * FROM "LegalCase" WHERE party = $1
           AND status NOT IN ('Settled','Dropped','Recovered','WrittenOff')
         ORDER BY "filedOn" DESC LIMIT 1`,
        [account.party]
      ),
    ]);

    // Fetch instalments for the payment plan if present
    let instalments: any[] = [];
    if (paymentPlans.length > 0) {
      instalments = await query<any>(
        `SELECT * FROM "PlanInstalment" WHERE "planId" = $1 ORDER BY "instNo" ASC`,
        [paymentPlans[0].id]
      );
    }

    return res.json({
      ok: true,
      data: {
        account,
        client,
        promises,
        holds,
        history,
        paymentPlan: paymentPlans[0] || null,
        instalments,
        legalCase,
      },
    });
  } catch (err: any) {
    console.error('[api/accounts/[id] GET] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Account fetch failed' });
  }
}

// ─── PATCH — mutate individual fields ─────────────────────────
const PatchBody = z.object({
  tier:          z.enum(['A','B','C','D','E']).optional(),
  alert:         z.string().max(200).nullable().optional(),
  stage:         z.string().max(200).nullable().optional(),
  status:        z.string().max(60).optional(),
  mgtNote:       z.string().max(5000).nullable().optional(),
  history:       z.string().max(20000).nullable().optional(),
  nextFu:        z.string().nullable().optional(),
  creditLimit:   z.number().nonnegative().max(1e12).optional(),
  creditPeriod:  z.string().max(60).nullable().optional(),
  onTimePct:     z.string().max(20).nullable().optional(),
});

const TIER_LABEL: Record<string, string> = {
  A: 'A — Recents', B: 'B — Due', C: 'C — Overdue', D: 'D — Doubtful', E: 'E — Legal',
};

async function handlePatch(req: NextApiRequest, res: NextApiResponse, user: any, id: string) {
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const body = parsed.data;

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE id = $1 LIMIT 1`, [id]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  // Build SET clause dynamically — only include keys that were sent.
  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  const historyEntries: Array<{ action: string; oldValue: string | null; newValue: string | null }> = [];

  if (body.tier !== undefined && body.tier !== acct.tier) {
    sets.push(`tier = $${i++}`);
    params.push(body.tier);
    // Treat manual tier change as override
    sets.push(`"tierOverride" = $${i++}`);
    params.push(body.tier);
    historyEntries.push({
      action: 'Tier changed',
      oldValue: TIER_LABEL[acct.tier] || acct.tier,
      newValue: TIER_LABEL[body.tier],
    });
  }
  if (body.alert !== undefined && body.alert !== acct.alert) {
    sets.push(`alert = $${i++}`);
    params.push(body.alert);
    sets.push(`"alertOverride" = $${i++}`);
    params.push(body.alert);
    historyEntries.push({ action: 'Alert updated', oldValue: acct.alert, newValue: body.alert });
  }
  if (body.stage !== undefined && body.stage !== acct.stage) {
    sets.push(`stage = $${i++}`);
    params.push(body.stage);
    historyEntries.push({ action: 'Stage updated', oldValue: acct.stage, newValue: body.stage });
  }
  if (body.status !== undefined && body.status !== acct.status) {
    sets.push(`status = $${i++}`);
    params.push(body.status);
    historyEntries.push({ action: 'Status updated', oldValue: acct.status, newValue: body.status });
  }
  if (body.mgtNote !== undefined && body.mgtNote !== acct.mgtNote) {
    sets.push(`"mgtNote" = $${i++}`);
    params.push(body.mgtNote);
    historyEntries.push({ action: 'Mgt note updated', oldValue: null, newValue: body.mgtNote });
  }
  if (body.history !== undefined && body.history !== acct.history) {
    sets.push(`history = $${i++}`);
    params.push(body.history);
    historyEntries.push({ action: 'History updated', oldValue: null, newValue: '(history block edited)' });
  }
  if (body.nextFu !== undefined) {
    sets.push(`"nextFu" = $${i++}`);
    params.push(body.nextFu);
    historyEntries.push({ action: 'Follow-up rescheduled', oldValue: null, newValue: body.nextFu || '(cleared)' });
  }
  if (body.creditLimit !== undefined && Number(body.creditLimit) !== Number(acct.creditLimit)) {
    sets.push(`"creditLimit" = $${i++}`);
    params.push(body.creditLimit);
    historyEntries.push({
      action: 'Credit limit updated',
      oldValue: `₹${Number(acct.creditLimit).toLocaleString('en-IN')}`,
      newValue: `₹${Number(body.creditLimit).toLocaleString('en-IN')}`,
    });
  }
  if (body.creditPeriod !== undefined && body.creditPeriod !== acct.creditPeriod) {
    sets.push(`"creditPeriod" = $${i++}`);
    params.push(body.creditPeriod);
    historyEntries.push({ action: 'Credit terms updated', oldValue: acct.creditPeriod, newValue: body.creditPeriod });
  }
  if (body.onTimePct !== undefined && body.onTimePct !== acct.onTimePct) {
    sets.push(`"onTimePct" = $${i++}`);
    params.push(body.onTimePct);
    historyEntries.push({ action: 'On-time pct updated', oldValue: acct.onTimePct, newValue: body.onTimePct });
  }

  if (sets.length === 0) {
    return res.json({ ok: true, changed: 0 });
  }

  sets.push(`"lastTouched" = NOW()`);
  sets.push(`"updatedAt" = NOW()`);

  try {
    await withTransaction(async (q) => {
      await q(
        `UPDATE "Account" SET ${sets.join(', ')} WHERE id = $${i++}`,
        [...params, id]
      );
      for (const h of historyEntries) {
        await q(
          `INSERT INTO "AccountHistory"
            (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, 'Portal')`,
          [newId('hist'), acct.party, user.name, acct.cm, h.action, h.oldValue, h.newValue, acct.bill]
        );
      }
    });

    audit(req, user, 'ACCOUNT_UPDATE', acct.party, body);

    return res.json({ ok: true, changed: historyEntries.length });
  } catch (err: any) {
    console.error('[api/accounts/[id] PATCH] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Account update failed' });
  }
}
