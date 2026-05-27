// ============================================================
// POST /api/legal/bulk-convert — create LegalCase rows for every
// owing account in a given family (or families matching a prefix).
// ============================================================
// Owner / Admin / CM only.
// Body (any subset; family + familyPrefix may be combined):
//   family       string  — exact family name (e.g. "LEGAL-ACA")
//   familyPrefix string  — substring match (e.g. "LEGAL-" → matches
//                           LEGAL-ACA, LEGAL-OTHERS, LEGAL-IIT, …)
// Behaviour:
//   • Skips parties that already have an OPEN LegalCase
//     (status NOT IN Settled/Dropped/Recovered/WrittenOff).
//   • Creates one LegalCase per remaining party with status='Filed',
//     outstanding = current bill, filedOn = NOW(), notes mention the
//     bulk source.
//   • Writes an AccountHistory entry per case (source='Portal'), so
//     each account drawer's Timeline tells the story.
//   • Returns { ok: true, created: N, skippedExisting: M, parties: [...] }
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, withTransaction, newId } from '@/lib/pg';
import { requireAuth, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';

const Body = z.object({
  family:       z.string().min(1).max(200).optional(),
  familyPrefix: z.string().min(1).max(200).optional(),
  notes:        z.string().max(2000).optional(),
}).refine(b => b.family || b.familyPrefix, {
  message: 'Provide either `family` or `familyPrefix`',
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'owner', 'admin', 'cm')) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const { family, familyPrefix, notes } = parsed.data;

  // Fetch matching accounts (excluding ones that already have an open legal case)
  const conditions: string[] = [`a.bill > 0`];
  const params: any[] = [];
  let i = 1;
  if (family) {
    conditions.push(`a.family = $${i++}`);
    params.push(family);
  } else if (familyPrefix) {
    conditions.push(`a.family ILIKE $${i++}`);
    params.push(`${familyPrefix}%`);
  }
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM "LegalCase" l
     WHERE l.party = a.party
       AND l.status NOT IN ('Settled','Dropped','Recovered','WrittenOff')
  )`);

  const candidates = await query<any>(
    `SELECT a.id, a.party, a.family, a.exec, a.cm, a.bill::float8 AS bill
       FROM "Account" a
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.bill DESC`,
    params
  );

  if (candidates.length === 0) {
    return res.json({ ok: true, created: 0, skippedExisting: 0, parties: [], message: 'No accounts qualify — they may already have open legal cases or zero balance.' });
  }

  const noteText = notes || `Bulk converted from ${family ? `family "${family}"` : `families starting with "${familyPrefix}"`}`;

  try {
    await withTransaction(async (q) => {
      // Bulk insert LegalCase rows via UNNEST (one round-trip)
      const ids        = candidates.map(() => newId('lc'));
      const parties    = candidates.map(c => c.party);
      const families   = candidates.map(c => c.family);
      const outs       = candidates.map(c => c.bill);

      await q(
        `INSERT INTO "LegalCase"
           (id, party, family, outstanding, status, "filedOn", notes, "updatedAt")
         SELECT t1, t2, t3, t4::numeric, 'Filed', NOW(), $5::text, NOW()
           FROM UNNEST($1::text[], $2::text[], $3::text[], $4::numeric[])
                AS t(t1, t2, t3, t4)`,
        [ids, parties, families, outs, noteText]
      );

      // History rows
      const hist = candidates.map(c => ({
        id: newId('hist'),
        party: c.party,
        exec: c.exec,
        cm: c.cm,
        outstanding: c.bill,
      }));
      await q(
        `INSERT INTO "AccountHistory"
           (id, ts, party, exec, cm, action, "newValue", outstanding, source)
         SELECT t1, NOW(), t2, t3, t4, 'Legal case opened', $6::text, t5::numeric, 'Portal'
           FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[])
                AS t(t1, t2, t3, t4, t5)`,
        [
          hist.map(h => h.id),
          hist.map(h => h.party),
          hist.map(h => h.exec),
          hist.map(h => h.cm),
          hist.map(h => h.outstanding),
          noteText,
        ]
      );

      // Bump lastTouched on every affected Account
      await q(
        `UPDATE "Account" SET "lastTouched" = NOW(), "updatedAt" = NOW()
           WHERE party = ANY($1::text[])`,
        [parties]
      );
    });

    audit(req, user, 'LEGAL_BULK_CONVERT', family || familyPrefix || '', {
      created: candidates.length,
      sample: candidates.slice(0, 5).map(c => c.party),
    });

    return res.json({
      ok: true,
      created: candidates.length,
      parties: candidates.map(c => ({ party: c.party, family: c.family, outstanding: c.bill })),
      message: `Converted ${candidates.length} account${candidates.length === 1 ? '' : 's'} into Filed legal cases.`,
    });
  } catch (err: any) {
    console.error('[api/legal/bulk-convert] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Bulk conversion failed' });
  }
}
