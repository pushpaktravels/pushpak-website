// ============================================================
// /api/queries/[id] — read one query; classify / remark / push / reject.
// ============================================================
//   GET                        → one submission (accounts desk).
//   PATCH { action: 'classify' } { classifyType, relatedParty }
//   PATCH { action: 'remark'   } { text }     → append to the remark log
//   PATCH { action: 'push'     }              → mark Accepted (DRY-RUN — does
//                                               NOT post to FinBook yet)
//   PATCH { action: 'reject'   } { note? }
//
// All mutations need edit rights on the 'queries' view (the accounts desk).
// "push" is the dry-run chokepoint: see lib/queries.ts + the FinBook dry-run
// list — flip to a real FinBook write when Calico is live.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';

const PatchBody = z.object({
  action: z.enum(['classify', 'remark', 'push', 'reject']),
  classifyType: z.enum(['supplier', 'client', 'card', 'payment']).optional().nullable(),
  relatedParty: z.string().max(200).optional().nullable(),
  text: z.string().max(2000).optional(),
  note: z.string().max(2000).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = String(req.query.id || '');

  if (req.method === 'GET') {
    if (!requireView(user, res, 'queries')) return;
    const row = await queryOne<any>(`SELECT * FROM "Query" WHERE id = $1`, [id]);
    if (!row) return res.status(404).json({ ok: false, error: 'Query not found' });
    return res.json({ ok: true, query: row });
  }

  if (req.method === 'PATCH') {
    if (!requireViewEdit(user, res, 'queries')) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
    const b = parsed.data;

    const existing = await queryOne<any>(`SELECT id, status FROM "Query" WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ ok: false, error: 'Query not found' });

    try {
      if (b.action === 'classify') {
        await query(
          `UPDATE "Query" SET "classifyType" = $2, "relatedParty" = $3, "updatedAt" = NOW() WHERE id = $1`,
          [id, b.classifyType || null, b.relatedParty || null],
        );
        audit(req, user, 'QUERY_CLASSIFY', id, { classifyType: b.classifyType, relatedParty: b.relatedParty });
      } else if (b.action === 'remark') {
        if (!b.text || !b.text.trim()) return res.status(400).json({ ok: false, error: 'Remark text is required' });
        const remark = { by: user.execId, name: user.name, at: new Date().toISOString(), text: b.text.trim() };
        await query(
          `UPDATE "Query" SET remarks = remarks || $2::jsonb, "updatedAt" = NOW() WHERE id = $1`,
          [id, JSON.stringify([remark])],
        );
        audit(req, user, 'QUERY_REMARK', id, {});
      } else if (b.action === 'push') {
        // DRY-RUN: mark Accepted only. No FinBook write (Calico not connected).
        await query(
          `UPDATE "Query" SET status = 'accepted', "reviewedByExecId" = $2, "reviewedByName" = $3, "reviewedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
          [id, user.execId, user.name],
        );
        audit(req, user, 'QUERY_PUSH_DRYRUN', id, {});
      } else if (b.action === 'reject') {
        const note = (b.note || '').trim();
        const remark = note ? [{ by: user.execId, name: user.name, at: new Date().toISOString(), text: `Rejected: ${note}` }] : [];
        await query(
          `UPDATE "Query" SET status = 'rejected', "reviewedByExecId" = $2, "reviewedByName" = $3, "reviewedAt" = NOW(),
                  remarks = remarks || $4::jsonb, "updatedAt" = NOW() WHERE id = $1`,
          [id, user.execId, user.name, JSON.stringify(remark)],
        );
        audit(req, user, 'QUERY_REJECT', id, { note });
      }
      const row = await queryOne<any>(`SELECT * FROM "Query" WHERE id = $1`, [id]);
      return res.json({ ok: true, query: row });
    } catch (err: any) {
      console.error('[api/queries/[id]] patch error', err);
      return res.status(500).json({ ok: false, error: err.message || 'Update failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
