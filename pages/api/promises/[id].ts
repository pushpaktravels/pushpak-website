// ============================================================
// PATCH /api/promises/[id] — settle a promise (Kept / Broken / Cancelled).
// ============================================================
// Body:
//   status          'Kept' | 'Broken' | 'Cancelled' (required)
//   amountReceived  number — required when status='Kept', else 0
//   settledOn       ISO date — defaults to today
//
// What it does, transactionally:
//   1) UPDATE Promise: status, settledOn, amountReceived
//   2) INSERT AccountHistory: action 'Promise kept/broken/cancelled'
//   3) UPDATE Account.lastTouched
//   4) INSERT PointEvent: Kept = +5, Broken = -3, Cancelled = 0
//
// Auth: visibleExecNames gate via the promise's account.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { audit } from '@/lib/audit';

const Body = z.object({
  status: z.enum(['Kept', 'Broken', 'Cancelled']),
  amountReceived: z.number().nonnegative().max(1e12).optional(),
  settledOn: z.string().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'promises')) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { status, amountReceived, settledOn } = parsed.data;

  // Look up the promise + its account for visibility check
  const promise = await queryOne<any>(`SELECT * FROM "Promise" WHERE id = $1 LIMIT 1`, [id]);
  if (!promise) return res.status(404).json({ ok: false, error: 'Promise not found' });
  if (promise.status !== 'Open') {
    return res.status(409).json({ ok: false, error: `Promise already ${promise.status.toLowerCase()}` });
  }

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [promise.party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  const settled = settledOn || new Date().toISOString();
  const received = status === 'Kept' ? (amountReceived || 0) : 0;
  const points = status === 'Kept' ? 5 : status === 'Broken' ? -3 : 0;
  const actionLabel = status === 'Kept' ? 'Promise kept' : status === 'Broken' ? 'Promise broken' : 'Promise cancelled';

  try {
    await withTransaction(async (q) => {
      await q(
        `UPDATE "Promise" SET status = $1, "settledOn" = $2, "amountReceived" = $3 WHERE id = $4`,
        [status, settled, received, id]
      );

      const historyValue = status === 'Kept'
        ? `₹${Number(received).toLocaleString('en-IN')} received`
        : status === 'Broken'
          ? `Due ${new Date(promise.expectedBy).toLocaleDateString('en-IN')} — not received`
          : `Cancelled by ${user.name}`;

      await q(
        `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "newValue", outstanding, source)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, 'Portal')`,
        [newId('hist'), promise.party, user.name, acct.cm, actionLabel, historyValue, acct.bill]
      );

      await q(
        `UPDATE "Account" SET "lastTouched" = NOW(), "updatedAt" = NOW() WHERE party = $1`,
        [promise.party]
      );

      if (points !== 0) {
        const eventName = status === 'Kept' ? 'PROMISE_KEPT' : 'PROMISE_BROKEN';
        await q(
          `INSERT INTO "PointEvent" (id, ts, exec, event, party, points, detail)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6)`,
          [newId('pt'), user.name, eventName, promise.party, points, actionLabel]
        );
      }
    });

    audit(req, user, `PROMISE_${status.toUpperCase()}`, promise.party, { promiseId: id, amountReceived: received });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[api/promises/[id]] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Settle promise failed' });
  }
}
