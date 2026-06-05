// ============================================================
// /api/reco — reconciliation status board: list + add account.
// ============================================================
// GET  → every active reconciliation account with its latest log and a
//        computed "done for the current period?" flag, plus headline counts.
//        ?kind=bank|airline narrows the list; ?all=1 includes inactive.
// POST → add a new account to reconcile (a bank or an airline).
//
// Portal-only: never touches FinBook. Gated on the 'reco' view; adding an
// account needs view-edit.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView, requireViewEdit } from '@/lib/views';
import { audit } from '@/lib/audit';
import { RECO_KINDS, RECO_CADENCES, periodKey, periodLabel } from '@/lib/reco';

const CreateBody = z.object({
  kind:       z.enum(RECO_KINDS as unknown as [string, ...string[]]),
  name:       z.string().min(1).max(160),
  identifier: z.string().max(120).optional().nullable(),
  cadence:    z.enum(RECO_CADENCES as unknown as [string, ...string[]]).default('daily'),
  department: z.string().max(60).optional().nullable(),
  ownerName:  z.string().max(120).optional().nullable(),
  sortOrder:  z.coerce.number().int().min(0).max(9999).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'reco')) return;

  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return create(req, res, user);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function list(req: NextApiRequest, res: NextApiResponse) {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
  const includeInactive = req.query.all === '1';
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (!includeInactive) conditions.push(`a.active = TRUE`);
  if (kind && (RECO_KINDS as readonly string[]).includes(kind)) { conditions.push(`a.kind = $${i++}`); params.push(kind); }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const rows = await query<any>(
      `SELECT a.id, a.kind, a.name, a.identifier, a.cadence, a.department, a."ownerName",
              a."sortOrder", a.active,
              l.id AS "logId", l."periodKey" AS "lastPeriodKey", l."periodLabel" AS "lastPeriodLabel",
              l.status AS "lastStatus", l."statementBalance", l."bookBalance", l.difference, l.note,
              l."reconciledByName", l."reconciledAt"
         FROM "RecoAccount" a
         LEFT JOIN LATERAL (
           SELECT * FROM "RecoLog" WHERE "accountId" = a.id ORDER BY "reconciledAt" DESC LIMIT 1
         ) l ON TRUE
         ${whereSql}
         ORDER BY a."sortOrder" ASC, a.kind ASC, a.name ASC
         LIMIT 1000`,
      params
    );

    const now = new Date();
    let doneCount = 0, flaggedCount = 0, pendingCount = 0;
    const accounts = rows.map((r: any) => {
      const curKey = periodKey(r.cadence, now);
      const curLabel = periodLabel(r.cadence, now);
      const upToDate = r.lastPeriodKey === curKey;
      const status = upToDate ? (r.lastStatus || 'done') : 'pending';
      if (r.active) {
        if (status === 'done') doneCount++;
        else if (status === 'flagged') flaggedCount++;
        else pendingCount++;
      }
      return {
        id: r.id, kind: r.kind, name: r.name, identifier: r.identifier, cadence: r.cadence,
        department: r.department, ownerName: r.ownerName, sortOrder: r.sortOrder, active: r.active,
        currentPeriodKey: curKey, currentPeriodLabel: curLabel,
        upToDate, status,
        last: r.logId ? {
          periodKey: r.lastPeriodKey, periodLabel: r.lastPeriodLabel, status: r.lastStatus,
          statementBalance: r.statementBalance, bookBalance: r.bookBalance, difference: r.difference,
          note: r.note, reconciledByName: r.reconciledByName, reconciledAt: r.reconciledAt,
        } : null,
      };
    });

    return res.json({
      ok: true,
      data: { accounts, summary: { total: accounts.filter((a: any) => a.active).length, done: doneCount, flagged: flaggedCount, pending: pendingCount } },
    });
  } catch (err: any) {
    console.error('[api/reco] list error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Reco query failed' });
  }
}

async function create(req: NextApiRequest, res: NextApiResponse, user: any) {
  if (!requireViewEdit(user, res, 'reco')) return;
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const id = newId('reco');
  try {
    await query(
      `INSERT INTO "RecoAccount"
         (id, kind, name, identifier, cadence, department, "ownerName", "sortOrder", active, "createdBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,NOW(),NOW())`,
      [id, b.kind, b.name, b.identifier || null, b.cadence, b.department || null, b.ownerName || null, b.sortOrder ?? 0, user.execId]
    );
    audit(req, user, 'RECO_ACCOUNT_ADD', b.name, { id, kind: b.kind, cadence: b.cadence });
    const row = await queryOne<any>(`SELECT * FROM "RecoAccount" WHERE id = $1`, [id]);
    return res.json({ ok: true, data: { account: row } });
  } catch (err: any) {
    console.error('[api/reco] create error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Create reco account failed' });
  }
}
