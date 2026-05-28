// ============================================================
// POST /api/activity/ping — client heartbeat while user is active.
// ============================================================
// Body: { page: string }
//
// Server computes elapsed-since-last-ping for the calling user and
// adds it to that user's row in ActivityDay (today's date in IST).
// Elapsed is capped at 90 seconds so a network hiccup / stalled
// laptop can't inflate the active-time count.
//
// Also updates the pageBreakdown JSON so we know where they spent
// the time. Returns the updated total for that day so the client
// can render a "you've worked X minutes today" badge.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';

const Body = z.object({ page: z.string().max(120).optional() });

// IST date so a heartbeat at 11pm IST goes to today's row, not
// tomorrow's UTC date.
function todayIST(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 5);
  d.setUTCMinutes(d.getUTCMinutes() + 30);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;

  const parsed = Body.safeParse(req.body);
  const page = parsed.success ? (parsed.data.page || '/') : '/';
  const date = todayIST();
  const MAX_ELAPSED = 90;

  // Fetch the user's current row to compute elapsed
  const existing = await queryOne<any>(
    `SELECT "lastPingAt", "activeSec", "pageBreakdown"
       FROM "ActivityDay"
      WHERE "userId" = $1 AND date = $2 LIMIT 1`,
    [user.id, date]
  );

  let elapsed = 0;
  if (existing?.lastPingAt) {
    const ms = Date.now() - +new Date(existing.lastPingAt);
    elapsed = Math.min(MAX_ELAPSED, Math.max(0, Math.round(ms / 1000)));
  }

  // Merge page breakdown
  const breakdown = existing?.pageBreakdown || {};
  breakdown[page] = (breakdown[page] || 0) + elapsed;

  if (existing) {
    await query(
      `UPDATE "ActivityDay"
          SET "activeSec"     = "activeSec" + $1,
              "lastPingAt"    = NOW(),
              "lastPage"      = $2,
              "pageBreakdown" = $3::jsonb,
              "updatedAt"     = NOW()
        WHERE "userId" = $4 AND date = $5`,
      [elapsed, page, JSON.stringify(breakdown), user.id, date]
    );
  } else {
    await query(
      `INSERT INTO "ActivityDay"
         ("userId", date, "activeSec", "lastPingAt", "lastPage", "pageBreakdown",
          "execId", "userName")
       VALUES ($1, $2, 0, NOW(), $3, $4::jsonb, $5, $6)`,
      [user.id, date, page, JSON.stringify(breakdown), user.execId, user.name]
    );
  }

  return res.json({
    ok: true,
    activeSec: (existing?.activeSec || 0) + elapsed,
    elapsed,
  });
}
