// ============================================================
// PATCH /api/payment-plans/[id] — update a Doubtful payment plan.
// ============================================================
// Body (any subset):
//   planTotal     number
//   startDate     ISO date
//   cancelled     boolean (true → set cancelledAt = NOW, false → clear)
//   instalments   [{ id, status?, received?, settledOn? }]
//
// Every change writes to AccountHistory.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { audit } from '@/lib/audit';

const InstalmentUpdate = z.object({
  id:        z.string(),
  status:    z.enum(['Pending','Received','Broken','Cancelled']).optional(),
  received:  z.number().nonnegative().max(1e12).optional(),
  amount:    z.number().nonnegative().max(1e12).optional(),
  dueDate:   z.string().optional(),
  settledOn: z.string().nullable().optional(),
});

const NewInstalment = z.object({
  dueDate: z.string(),
  amount:  z.number().nonnegative().max(1e12),
});

const Body = z.object({
  planTotal:      z.number().nonnegative().max(1e12).optional(),
  startDate:      z.string().optional(),
  cancelled:      z.boolean().optional(),
  instalments:    z.array(InstalmentUpdate).optional(),
  newInstalments: z.array(NewInstalment).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const body = parsed.data;

  const plan = await queryOne<any>(`SELECT * FROM "PaymentPlan" WHERE id = $1 LIMIT 1`, [id]);
  if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found' });

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [plan.party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  const planSets: string[] = [];
  const planParams: any[] = [];
  let i = 1;
  const historyEntries: Array<{ action: string; oldValue: string | null; newValue: string | null }> = [];

  if (body.planTotal !== undefined && Number(body.planTotal) !== Number(plan.planTotal)) {
    planSets.push(`"planTotal" = $${i++}`); planParams.push(body.planTotal);
    historyEntries.push({ action: 'Plan total updated', oldValue: `₹${Number(plan.planTotal).toLocaleString('en-IN')}`, newValue: `₹${Number(body.planTotal).toLocaleString('en-IN')}` });
  }
  if (body.startDate !== undefined && body.startDate !== String(plan.startDate).slice(0, 10)) {
    planSets.push(`"startDate" = $${i++}`); planParams.push(body.startDate);
    historyEntries.push({ action: 'Plan start date', oldValue: String(plan.startDate).slice(0, 10), newValue: body.startDate });
  }
  if (body.cancelled === true && !plan.cancelledAt) {
    planSets.push(`"cancelledAt" = NOW()`);
    historyEntries.push({ action: 'Plan cancelled', oldValue: null, newValue: 'Cancelled' });
  }
  if (body.cancelled === false && plan.cancelledAt) {
    planSets.push(`"cancelledAt" = NULL`);
    historyEntries.push({ action: 'Plan reactivated', oldValue: 'Cancelled', newValue: 'Active' });
  }

  try {
    await withTransaction(async (q) => {
      if (planSets.length > 0) {
        await q(
          `UPDATE "PaymentPlan" SET ${planSets.join(', ')} WHERE id = $${i++}`,
          [...planParams, id]
        );
      }

      // Instalment updates
      if (body.instalments) {
        for (const inst of body.instalments) {
          const existing = await q(`SELECT * FROM "PlanInstalment" WHERE id = $1 AND "planId" = $2 LIMIT 1`, [inst.id, id]);
          if (existing.length === 0) continue;
          const ex = existing[0];
          const instSets: string[] = [];
          const instParams: any[] = [];
          let j = 1;
          if (inst.status !== undefined && inst.status !== ex.status) {
            instSets.push(`status = $${j++}`); instParams.push(inst.status);
            historyEntries.push({ action: `Instalment ${ex.instNo}`, oldValue: ex.status, newValue: inst.status });
            // If newly received, also stamp settledOn
            if (inst.status === 'Received' && !ex.settledOn && inst.settledOn === undefined) {
              instSets.push(`"settledOn" = NOW()`);
            }
          }
          if (inst.received !== undefined && Number(inst.received) !== Number(ex.received)) {
            instSets.push(`received = $${j++}`); instParams.push(inst.received);
            historyEntries.push({ action: `Instalment ${ex.instNo} received`, oldValue: `₹${Number(ex.received).toLocaleString('en-IN')}`, newValue: `₹${Number(inst.received).toLocaleString('en-IN')}` });
          }
          if (inst.amount !== undefined && Number(inst.amount) !== Number(ex.amount)) {
            instSets.push(`amount = $${j++}`); instParams.push(inst.amount);
            historyEntries.push({ action: `Instalment ${ex.instNo} amount`, oldValue: `₹${Number(ex.amount).toLocaleString('en-IN')}`, newValue: `₹${Number(inst.amount).toLocaleString('en-IN')}` });
          }
          if (inst.dueDate !== undefined && inst.dueDate !== String(ex.dueDate).slice(0, 10)) {
            instSets.push(`"dueDate" = $${j++}`); instParams.push(inst.dueDate);
            historyEntries.push({ action: `Instalment ${ex.instNo} due date`, oldValue: String(ex.dueDate).slice(0, 10), newValue: inst.dueDate });
          }
          if (inst.settledOn !== undefined) {
            instSets.push(`"settledOn" = $${j++}`); instParams.push(inst.settledOn);
          }
          if (instSets.length > 0) {
            await q(`UPDATE "PlanInstalment" SET ${instSets.join(', ')} WHERE id = $${j++}`, [...instParams, inst.id]);
          }
        }
      }

      // New instalments appended to the plan
      if (body.newInstalments && body.newInstalments.length > 0) {
        // Find current max instNo
        const maxRows = await q(`SELECT COALESCE(MAX("instNo"), 0) AS max FROM "PlanInstalment" WHERE "planId" = $1`, [id]);
        let nextNo = Number(maxRows[0]?.max || 0);
        for (const ni of body.newInstalments) {
          nextNo += 1;
          const instId = newId('inst');
          await q(
            `INSERT INTO "PlanInstalment" (id, "planId", "instNo", "dueDate", amount, status, received)
             VALUES ($1, $2, $3, $4, $5, 'Pending', 0)`,
            [instId, id, nextNo, ni.dueDate, ni.amount]
          );
          historyEntries.push({
            action: `Instalment ${nextNo} added`,
            oldValue: null,
            newValue: `₹${Number(ni.amount).toLocaleString('en-IN')} due ${ni.dueDate}`,
          });
        }
      }

      // History entries
      for (const h of historyEntries) {
        await q(
          `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, 'Portal')`,
          [newId('hist'), plan.party, user.name, acct.cm, h.action, h.oldValue, h.newValue, acct.bill]
        );
      }

      await q(`UPDATE "Account" SET "lastTouched" = NOW(), "updatedAt" = NOW() WHERE party = $1`, [plan.party]);
    });

    audit(req, user, 'PLAN_UPDATE', plan.party, body);
    return res.json({ ok: true, changed: historyEntries.length });
  } catch (err: any) {
    console.error('[api/payment-plans/[id] PATCH] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Plan update failed' });
  }
}
