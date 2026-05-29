// ============================================================
// PATCH /api/legal/[id] — update a legal case.
// ============================================================
// Body keys (any subset):
//   status       'NoticeSent' | 'Filed' | 'InCourt' | 'Settled'
//                | 'Dropped' | 'Recovered' | 'WrittenOff'
//   lawyer       string
//   caseRef      string
//   nextHearing  ISO date
//   notes        string
//   outstanding  number
//
// Terminal statuses (Settled/Dropped/Recovered/WrittenOff) auto-fill
// closedOn = NOW(). Every change is logged to AccountHistory.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const Body = z.object({
  status:      z.enum(['NoticeSent','Filed','InCourt','Settled','Dropped','Recovered','WrittenOff']).optional(),
  lawyer:      z.string().max(200).nullable().optional(),
  caseRef:     z.string().max(120).nullable().optional(),
  nextHearing: z.string().nullable().optional(),
  notes:       z.string().max(5000).nullable().optional(),
  outstanding: z.number().nonnegative().max(1e12).optional(),
});

const TERMINAL = new Set(['Settled','Dropped','Recovered','WrittenOff']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'legal')) return;
  if (!requireViewEdit(user, res, 'legal')) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const body = parsed.data;

  const legal = await queryOne<any>(`SELECT * FROM "LegalCase" WHERE id = $1 LIMIT 1`, [id]);
  if (!legal) return res.status(404).json({ ok: false, error: 'Legal case not found' });

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [legal.party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const visible = visibleExecNames(user);
  if (visible !== null && acct.exec && !visible.has(acct.exec.toUpperCase())) {
    return res.status(403).json({ ok: false, error: 'Not allowed for your scope' });
  }

  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  const historyEntries: Array<{ action: string; oldValue: string | null; newValue: string | null }> = [];

  if (body.status !== undefined && body.status !== legal.status) {
    sets.push(`status = $${i++}`); params.push(body.status);
    if (TERMINAL.has(body.status) && !legal.closedOn) {
      sets.push(`"closedOn" = NOW()`);
    } else if (!TERMINAL.has(body.status) && legal.closedOn) {
      sets.push(`"closedOn" = NULL`);
    }
    historyEntries.push({ action: 'Legal status', oldValue: legal.status, newValue: body.status });
  }
  if (body.lawyer !== undefined && body.lawyer !== legal.lawyer) {
    sets.push(`lawyer = $${i++}`); params.push(body.lawyer);
    historyEntries.push({ action: 'Lawyer updated', oldValue: legal.lawyer, newValue: body.lawyer });
  }
  if (body.caseRef !== undefined && body.caseRef !== legal.caseRef) {
    sets.push(`"caseRef" = $${i++}`); params.push(body.caseRef);
    historyEntries.push({ action: 'Case ref updated', oldValue: legal.caseRef, newValue: body.caseRef });
  }
  if (body.nextHearing !== undefined) {
    sets.push(`"nextHearing" = $${i++}`); params.push(body.nextHearing);
    historyEntries.push({ action: 'Next hearing', oldValue: legal.nextHearing, newValue: body.nextHearing || '(cleared)' });
  }
  if (body.notes !== undefined && body.notes !== legal.notes) {
    sets.push(`notes = $${i++}`); params.push(body.notes);
    historyEntries.push({ action: 'Legal notes updated', oldValue: null, newValue: '(edited)' });
  }
  if (body.outstanding !== undefined && Number(body.outstanding) !== Number(legal.outstanding)) {
    sets.push(`outstanding = $${i++}`); params.push(body.outstanding);
    historyEntries.push({ action: 'Legal outstanding', oldValue: String(legal.outstanding), newValue: String(body.outstanding) });
  }

  if (sets.length === 0) return res.json({ ok: true, changed: 0 });

  try {
    await withTransaction(async (q) => {
      await q(`UPDATE "LegalCase" SET ${sets.join(', ')} WHERE id = $${i++}`, [...params, id]);
      for (const h of historyEntries) {
        await q(
          `INSERT INTO "AccountHistory" (id, ts, party, exec, cm, action, "oldValue", "newValue", outstanding, source)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, 'Portal')`,
          [newId('hist'), legal.party, user.name, acct.cm, h.action, h.oldValue, h.newValue, acct.bill]
        );
      }
      // Bump account.lastTouched
      await q(`UPDATE "Account" SET "lastTouched" = NOW(), "updatedAt" = NOW() WHERE party = $1`, [legal.party]);
    });

    audit(req, user, 'LEGAL_UPDATE', legal.party, body);
    return res.json({ ok: true, changed: historyEntries.length });
  } catch (err: any) {
    console.error('[api/legal/[id] PATCH] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Legal update failed' });
  }
}
