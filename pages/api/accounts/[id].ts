// ============================================================
// GET /api/accounts/[id] — full account detail for the drawer.
// ============================================================
// Returns:
//   account  — full Account row
//   client   — matching ClientMaster row (contact info, owner, VIP flag)
//   promises — open + recent closed promises for this party
//   holds    — hold history (Candidate/Active/Released)
//   history  — AccountHistory timeline, newest first
//
// Authorisation: respects visibleExecNames (CMs see their team only, etc.)
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  try {
    const account = await queryOne<any>(`SELECT * FROM "Account" WHERE id = $1 LIMIT 1`, [id]);
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

    // Visibility check — owner/admin/analyst see all; others gated by exec name.
    const visible = visibleExecNames(user);
    if (visible !== null) {
      const execUpper = (account.exec || '').toUpperCase();
      if (!visible.has(execUpper)) {
        return res.status(403).json({ ok: false, error: 'Not allowed for your role' });
      }
    }

    // Fetch sibling rows in parallel — all keyed by party (the business key).
    const [client, promises, holds, history] = await Promise.all([
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
    ]);

    return res.json({
      ok: true,
      data: { account, client, promises, holds, history },
    });
  } catch (err: any) {
    console.error('[api/accounts/[id]] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Account fetch failed' });
  }
}
