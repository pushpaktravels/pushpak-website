// ============================================================
// POST /api/accounts/bulk-assign — bulk-set CM (or exec) on many accounts.
// ============================================================
// Owner / Admin / CM only. Body:
//   accountIds  string[]   (1..1000 ids)
//   cm          string?    (set "" or null to clear)
//   exec        string?    (set "" or null to clear)
//
// At least one of cm / exec must be provided. Per-account
// AccountHistory rows are inserted in one bulk shot via UNNEST.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, withTransaction, newId } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';

const Body = z.object({
  accountIds: z.array(z.string().min(1)).min(1).max(1000),
  cm:         z.string().max(120).nullable().optional(),
  exec:       z.string().max(120).nullable().optional(),
}).refine(b => b.cm !== undefined || b.exec !== undefined, {
  message: 'Provide cm and/or exec',
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin', 'cm')) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { accountIds, cm, exec } = parsed.data;

  // Fetch the accounts to confirm they exist + capture old values for history
  const accounts = await query<any>(
    `SELECT id, party, exec, cm FROM "Account" WHERE id = ANY($1::text[])`,
    [accountIds]
  );
  if (accounts.length === 0) return res.status(404).json({ ok: false, error: 'No matching accounts' });

  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (cm !== undefined) {
    sets.push(`cm = $${i++}`);
    params.push(cm || null);
  }
  if (exec !== undefined) {
    sets.push(`exec = $${i++}`);
    params.push(exec || null);
    // Setting exec via bulk-assign counts as manual reassignment — set
    // the override so a future Clientwise upload doesn't undo it.
    sets.push(`"execOverride" = $${i++}`);
    params.push(exec || null);
  }
  sets.push(`"lastTouched" = NOW()`);
  sets.push(`"updatedAt"   = NOW()`);

  try {
    await withTransaction(async (q) => {
      await q(
        `UPDATE "Account" SET ${sets.join(', ')} WHERE id = ANY($${i++}::text[])`,
        [...params, accountIds]
      );

      // Bulk insert history via UNNEST
      const histParties: string[] = [];
      const histActions: string[] = [];
      const histOlds:    (string | null)[] = [];
      const histNews:    (string | null)[] = [];
      for (const a of accounts) {
        if (cm !== undefined && (cm || null) !== (a.cm || null)) {
          histParties.push(a.party);
          histActions.push('CM reassigned (bulk)');
          histOlds.push(a.cm || null);
          histNews.push(cm || '(cleared)');
        }
        if (exec !== undefined && (exec || null) !== (a.exec || null)) {
          histParties.push(a.party);
          histActions.push('Exec reassigned (bulk)');
          histOlds.push(a.exec || null);
          histNews.push(exec || '(cleared)');
        }
      }
      if (histParties.length > 0) {
        const ids = histParties.map(() => newId('hist'));
        const sources = histParties.map(() => 'Portal');
        await q(
          `INSERT INTO "AccountHistory" (id, ts, party, action, "oldValue", "newValue", source)
           SELECT t1, NOW(), t2, t3, t4, t5, t6
             FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
                  AS t(t1, t2, t3, t4, t5, t6)`,
          [ids, histParties, histActions, histOlds, histNews, sources]
        );
      }
    });

    audit(req, user, 'BULK_ASSIGN', `${accountIds.length} accounts`, { cm, exec, sample: accounts.slice(0, 5).map(a => a.party) });

    return res.json({ ok: true, updated: accounts.length });
  } catch (err: any) {
    console.error('[api/accounts/bulk-assign] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Bulk assign failed' });
  }
}
