// GET /api/statement?party=NAME — payload for the printable
// Statement of Accounts at /portal/statement/[party].
//
// We return contact details MASKED in the statement preview but the
// statement PDF doesn't include them anyway (it's meant for the
// customer, not for the exec). Address is shown unmasked since
// the customer already knows their own address.
import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'worklist')) return;
  const party = typeof req.query.party === 'string' ? req.query.party.trim() : '';
  if (!party) return res.status(400).json({ ok: false, error: 'Missing party' });

  const acct = await queryOne<any>(`SELECT * FROM "Account" WHERE party = $1 LIMIT 1`, [party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  const [client, history, promises] = await Promise.all([
    queryOne<any>(`SELECT party, family, address FROM "ClientMaster" WHERE party = $1 LIMIT 1`, [party]),
    query<any>(
      `SELECT ts, action, "newValue", outstanding::float8 AS outstanding
         FROM "AccountHistory"
        WHERE party = $1 AND source <> 'Refresh'
        ORDER BY ts DESC
        LIMIT 50`,
      [party]
    ),
    query<any>(
      `SELECT "expectedBy", "outstandingAt"::float8 AS "outstandingAt",
              status, "amountReceived"::float8 AS "amountReceived"
         FROM "Promise"
        WHERE party = $1
        ORDER BY "expectedBy" DESC LIMIT 12`,
      [party]
    ),
  ]);

  return res.json({
    ok: true,
    data: {
      party: acct.party,
      family: acct.family,
      exec: acct.exec,
      cm: acct.cm,
      bill: Number(acct.bill),
      d30:  Number(acct.d30),
      d60:  Number(acct.d60),
      d90:  Number(acct.d90),
      d90p: Number(acct.d90p),
      recentCall: acct.recentCall,
      nextFu: acct.nextFu,
      creditLimit: Number(acct.creditLimit),
      creditPeriod: acct.creditPeriod,
      client,
      history,
      promises,
    },
  });
}
