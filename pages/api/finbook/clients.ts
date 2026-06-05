// ============================================================
// /api/finbook/clients — client-name autocomplete + remembered FinBook code.
// ============================================================
// Powers the FinBook console search so nobody hand-types "CCA000001":
//   GET  ?q=<name>  → up to 12 matching debtor accounts (party + family) with
//                     their remembered FinBook code, if we've learned it.
//   PATCH {party, finbookClientId} → remember (or clear) the FinBook code for
//                     a party, so picking that name auto-fills the code next
//                     time. Code must start with 'C' (FinBook ledger ids do).
//
// Read-only on FinBook itself — this only reads/writes OUR Account table.
// Gated on the 'finbook' view; remembering a code needs edit rights too.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'finbook')) return;

  if (req.method === 'GET') return search(req, res);
  if (req.method === 'PATCH') return remember(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function search(req: NextApiRequest, res: NextApiResponse) {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, clients: [] });

  // Match on the client/ledger name (party) or its family grouping. Accounts
  // that already have a remembered FinBook code sort first so the common
  // case (a client we've billed before) surfaces at the top.
  const rows = await query<any>(
    `SELECT party, family, "finbookClientId", bill
       FROM "Account"
      WHERE party ILIKE $1 OR family ILIKE $1
      ORDER BY ("finbookClientId" IS NULL), party
      LIMIT 12`,
    [`%${q}%`],
  );

  return res.json({
    ok: true,
    clients: rows.map((r) => ({
      party: r.party,
      family: r.family,
      finbookClientId: r.finbookClientId || null,
      outstanding: Number(r.bill) || 0,
    })),
  });
}

const PatchBody = z.object({
  party: z.string().min(1),
  // '' clears a wrong code; otherwise it must look like a FinBook ledger id.
  finbookClientId: z.string().max(40).regex(/^$|^C/i, "Code must start with 'C' (e.g. CCA000001)"),
});

async function remember(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireViewEdit(user, res, 'finbook')) return;
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { party } = parsed.data;
  const code = parsed.data.finbookClientId.trim().toUpperCase();

  const acct = await queryOne<any>(`SELECT party FROM "Account" WHERE party = $1 LIMIT 1`, [party]);
  if (!acct) return res.status(404).json({ ok: false, error: 'Account not found' });

  await query(
    `UPDATE "Account" SET "finbookClientId" = $2, "updatedAt" = NOW() WHERE party = $1`,
    [party, code || null],
  );
  audit(req, user, 'FINBOOK_CODE_REMEMBER', party, { finbookClientId: code || null });
  return res.json({ ok: true, party, finbookClientId: code || null });
}
