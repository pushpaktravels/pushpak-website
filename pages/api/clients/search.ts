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

// Who may SEARCH the client master (name typeahead). 'query-fill' is in here
// because a form-filler picks which account a query is about — but note it is
// a UNIVERSAL view (every role holds it), so this list effectively opens the
// NAME search to all staff. That's fine: a name is not financial data.
const SEARCH_VIEWS = ['reservations', 'card-log', 'query-fill', 'worklist', 'finbook', 'vendor-pay'];

// Who may additionally see the OUTSTANDING BALANCE. This is finance context,
// so it is the booking + accounts desks only — NOT the universal 'query-fill'.
// A delinquent's due is exactly what a booker/collector should see (booking
// hold for defaulters); a driver filing a courier form has no business seeing
// any client's balance. Keeping 'query-fill' out of THIS list is what closes
// the leak while leaving the account picker working for everyone.
const BALANCE_VIEWS = ['reservations', 'card-log', 'worklist', 'finbook', 'vendor-pay'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!SEARCH_VIEWS.some(v => canAccessView(user, v))) {
    return res.status(403).json({ ok: false, error: 'Not allowed' });
  }
  const showBalance = BALANCE_VIEWS.some(v => canAccessView(user, v));

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
    // Balance is zeroed for non-finance desks so the picker shows no "due"
    // badge (ClientPicker only renders it when outstanding > 0).
    clients: rows.map((r) => ({
      party: r.party,
      family: r.family,
      outstanding: showBalance ? (Number(r.bill) || 0) : 0,
    })),
  });
}
