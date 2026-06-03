// ============================================================
// /api/finbook/account — live ledger + credit limit for one client.
// ============================================================
// The read half of the FinBook integration ("Live ledger in portal").
// Pulls a client's statement (GET /clientledger) and sanctioned/available
// credit (GET /clientlimit) and returns them together for the FinBook
// console drawer. Read-only: it never writes to FinBook.
//
// Gated on the 'finbook' view (owner/admin + accounts). In dry-run mode
// (default until Calico unblocks our IP) it returns realistic SIMULATED
// data, flagged so the UI badges it — so the flow is fully testable now.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { getClientLedger, getClientLimit, finbookMode } from '@/lib/finbook';
import { audit } from '@/lib/audit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'finbook')) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const clientId = String(req.query.clientId || req.query.clientid || '').trim();
  if (!clientId) return res.status(400).json({ ok: false, error: 'Missing clientId' });
  // FinBook requires the ledger client id to start with 'C'.
  if (!/^C/i.test(clientId)) {
    return res.status(400).json({ ok: false, error: "Client id must start with 'C' (e.g. CCA000001)" });
  }

  // Window: default last 365 days; accept ?from / ?to (YYYY-MM-DD).
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ ok: false, error: 'Invalid from/to date' });
  }

  try {
    const [ledger, limit] = await Promise.all([
      getClientLedger({ clientId, from, to }),
      getClientLimit({ clientId }),
    ]);

    // A read failure on FinBook is reported, not thrown — the console shows
    // the error inline instead of a 500 page.
    if (!ledger.ok) {
      return res.status(502).json({ ok: false, error: `Ledger: ${ledger.error}`, mode: finbookMode() });
    }

    // Looking at a client's financials is auditable (PII / money).
    audit(req, user, 'FINBOOK_LEDGER_VIEW', clientId, {
      mode: ledger.mode, simulated: ledger.simulated,
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    });

    return res.json({
      ok: true,
      mode: ledger.mode,
      simulated: ledger.simulated,
      data: {
        ledger: ledger.data,
        limit: limit.ok ? limit.data : null,
        limitError: limit.ok ? null : limit.error,
      },
    });
  } catch (err: any) {
    console.error('[api/finbook/account] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'FinBook lookup failed' });
  }
}
