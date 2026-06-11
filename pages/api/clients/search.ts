// ============================================================
// GET /api/clients/search?q=<name> — client (Account) typeahead for bookings.
// ============================================================
// The booking-desk-facing version of the client list. Where
// /api/finbook/clients is gated on the 'finbook' view (the accounts console),
// this one is open to any desk that books — reservations, card log, or a
// form-filler picking an account — so a reservation agent can pick the client
// being billed without holding FinBook access.
//
// Read-only over OUR "Account" table (the one client master). Returns party +
// family + outstanding so the picker can show a little context. Excludes
// insights-only identities (they can't access any booking view).
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { canAccessView } from '@/lib/views';

// Any one of these capabilities admits the client search.
const ALLOW_VIEWS = ['reservations', 'card-log', 'query-fill', 'worklist', 'finbook', 'vendor-pay'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!ALLOW_VIEWS.some(v => canAccessView(user, v))) {
    return res.status(403).json({ ok: false, error: 'Not allowed' });
  }

  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, clients: [] });

  const rows = await query<any>(
    `SELECT party, family, bill
       FROM "Account"
      WHERE party ILIKE $1 OR family ILIKE $1
      ORDER BY party
      LIMIT 12`,
    [`%${q}%`],
  );
  return res.json({
    ok: true,
    clients: rows.map((r) => ({ party: r.party, family: r.family, outstanding: Number(r.bill) || 0 })),
  });
}
