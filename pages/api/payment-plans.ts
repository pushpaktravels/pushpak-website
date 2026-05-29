// ============================================================
// GET /api/payment-plans — Doubtful Ledger listing.
// ============================================================
// Returns active payment plans with instalment progress.
// Each plan gets its instalments inlined so the page can show
// the full schedule + payment progress in one render.
//
// Visibility: respects visibleExecNames via JOIN to Account.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth, visibleExecNames } from '@/lib/auth';
import { requireView } from '@/lib/views';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'payment-plans')) return;

  const visible = visibleExecNames(user);

  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (visible !== null && visible.size > 0) {
    const arr = Array.from(visible);
    const placeholders = arr.map(() => `$${i++}`).join(',');
    conditions.push(`a.exec IN (${placeholders})`);
    params.push(...arr);
  } else if (visible !== null && visible.size === 0) {
    return res.json({ ok: true, data: { plans: [] } });
  }

  // Optional status filter: active = no cancelledAt; all = include cancelled
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'active';
  if (scope === 'active') {
    conditions.push(`pp."cancelledAt" IS NULL`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // Plans
    const plans = await query<any>(
      `SELECT
         pp.*,
         a.id   AS account_id,
         a.exec AS exec,
         a.bill AS current_outstanding,
         a.tier AS tier
       FROM "PaymentPlan" pp
       LEFT JOIN "Account" a ON a.party = pp.party
       ${whereSql}
       ORDER BY pp."createdAt" DESC`,
      params
    );

    // Pull all instalments for these plan ids in one go
    const planIds = plans.map((p: any) => p.id);
    const instalments = planIds.length === 0 ? [] : await query<any>(
      `SELECT * FROM "PlanInstalment"
       WHERE "planId" = ANY($1::text[])
       ORDER BY "instNo" ASC`,
      [planIds]
    );

    // Group instalments under each plan + compute aggregate progress
    const instByPlan: Record<string, any[]> = {};
    instalments.forEach((inst: any) => {
      (instByPlan[inst.planId] ||= []).push(inst);
    });

    const result = plans.map((p: any) => {
      const items = instByPlan[p.id] || [];
      const received = items.reduce((n, i) => n + Number(i.received || 0), 0);
      const pending = items.filter(i => i.status === 'Pending').length;
      const broken  = items.filter(i => i.status === 'Broken').length;
      return {
        ...p,
        instalments: items,
        totalReceived: received,
        pendingCount: pending,
        brokenCount: broken,
      };
    });

    return res.json({ ok: true, data: { plans: result } });
  } catch (err: any) {
    console.error('[api/payment-plans] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Payment plans query failed' });
  }
}
