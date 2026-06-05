// ============================================================
// /api/reco/[id] — mark / unmark / edit an account, or read its history.
// ============================================================
// GET    → the account + its recent reconciliation logs (newest first).
// PATCH { action }:
//   mark    → reconcile the CURRENT period (upsert one log per period).
//             Optional statement/book balances auto-compute the difference;
//             a non-zero difference (or explicit flag) marks it 'flagged'.
//   unmark  → undo the current period's reconciliation (delete that log).
//   edit    → change account fields (name/identifier/cadence/kind/owner/…).
// DELETE → remove the account and all its logs (owner/admin only).
//
// Portal-only; never touches FinBook. View-edit on 'reco' for mutations.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { RECO_KINDS, RECO_CADENCES, periodKey, periodLabel } from '@/lib/reco';

const PatchBody = z.object({
  action:           z.enum(['mark', 'unmark', 'edit']),
  // mark
  statementBalance: z.coerce.number().optional().nullable(),
  bookBalance:      z.coerce.number().optional().nullable(),
  note:             z.string().max(1000).optional().nullable(),
  flagged:          z.boolean().optional(),
  // edit
  kind:       z.enum(RECO_KINDS as unknown as [string, ...string[]]).optional(),
  name:       z.string().min(1).max(160).optional(),
  identifier: z.string().max(120).optional().nullable(),
  cadence:    z.enum(RECO_CADENCES as unknown as [string, ...string[]]).optional(),
  department: z.string().max(60).optional().nullable(),
  ownerName:  z.string().max(120).optional().nullable(),
  sortOrder:  z.coerce.number().int().min(0).max(9999).optional(),
  active:     z.boolean().optional(),
});

const EDIT_COLUMN: Record<string, string> = {
  kind: 'kind', name: 'name', identifier: 'identifier', cadence: 'cadence',
  department: 'department', ownerName: '"ownerName"', sortOrder: '"sortOrder"', active: 'active',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'reco')) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const account = await queryOne<any>(`SELECT * FROM "RecoAccount" WHERE id = $1 LIMIT 1`, [id]);
  if (!account) return res.status(404).json({ ok: false, error: 'Reco account not found' });

  // History read — no mutation, so view (not view-edit) is enough.
  if (req.method === 'GET') {
    try {
      const logs = await query<any>(
        `SELECT * FROM "RecoLog" WHERE "accountId" = $1 ORDER BY "reconciledAt" DESC LIMIT 60`, [id]
      );
      return res.json({ ok: true, data: { account, logs } });
    } catch (err: any) {
      console.error('[api/reco/[id]] history error', err);
      return res.status(500).json({ ok: false, error: err.message || 'History query failed' });
    }
  }

  if (req.method === 'DELETE') {
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can delete a reco account' });
    }
    try {
      await query(`DELETE FROM "RecoLog" WHERE "accountId" = $1`, [id]);
      await query(`DELETE FROM "RecoAccount" WHERE id = $1`, [id]);
      audit(req, user, 'RECO_ACCOUNT_DELETE', account.name, { id });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[api/reco/[id]] delete error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Delete failed' });
    }
  }

  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!requireViewEdit(user, res, 'reco')) return;

  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;
  const now = new Date();
  const curKey = periodKey(account.cadence, now);
  const curLabel = periodLabel(account.cadence, now);

  try {
    if (b.action === 'mark') {
      const stmt = b.statementBalance ?? null;
      const book = b.bookBalance ?? null;
      const diff = (stmt != null && book != null) ? Number(stmt) - Number(book) : null;
      // Flagged if the books don't tie out, or the user explicitly flags it.
      const status = (b.flagged || (diff != null && Math.abs(diff) >= 0.01)) ? 'flagged' : 'done';
      const logId = newId('rlog');
      await query(
        `INSERT INTO "RecoLog"
           (id, "accountId", "periodKey", "periodLabel", status, "statementBalance", "bookBalance",
            difference, note, "reconciledByExecId", "reconciledByName", "reconciledAt", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
         ON CONFLICT ("accountId","periodKey") DO UPDATE SET
           status=EXCLUDED.status, "statementBalance"=EXCLUDED."statementBalance",
           "bookBalance"=EXCLUDED."bookBalance", difference=EXCLUDED.difference,
           note=EXCLUDED.note, "reconciledByExecId"=EXCLUDED."reconciledByExecId",
           "reconciledByName"=EXCLUDED."reconciledByName", "reconciledAt"=NOW()`,
        [logId, id, curKey, curLabel, status, stmt, book, diff, b.note || null, user.execId, user.name]
      );
      audit(req, user, 'RECO_MARK', account.name, { id, period: curKey, status, difference: diff });

    } else if (b.action === 'unmark') {
      await query(`DELETE FROM "RecoLog" WHERE "accountId" = $1 AND "periodKey" = $2`, [id, curKey]);
      audit(req, user, 'RECO_UNMARK', account.name, { id, period: curKey });

    } else { // edit
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      for (const [key, col] of Object.entries(EDIT_COLUMN)) {
        if (!(key in b)) continue;
        let val: any = (b as any)[key];
        if (key === 'identifier' || key === 'department' || key === 'ownerName') val = val || null;
        sets.push(`${col} = $${i++}`);
        params.push(val);
      }
      if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Nothing to update' });
      sets.push(`"updatedAt" = NOW()`);
      params.push(id);
      await query(`UPDATE "RecoAccount" SET ${sets.join(', ')} WHERE id = $${i}`, params);
      audit(req, user, 'RECO_ACCOUNT_UPDATE', account.name, { id, changed: Object.keys(b).filter(k => k !== 'action') });
    }

    // Return the refreshed account + its latest log so the board can update in place.
    const row = await queryOne<any>(`SELECT * FROM "RecoAccount" WHERE id = $1`, [id]);
    const last = await queryOne<any>(`SELECT * FROM "RecoLog" WHERE "accountId" = $1 ORDER BY "reconciledAt" DESC LIMIT 1`, [id]);
    return res.json({ ok: true, data: { account: row, last } });
  } catch (err: any) {
    console.error('[api/reco/[id]] patch error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Update failed' });
  }
}
