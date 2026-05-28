// ============================================================
// GET /api/cron/daily-digest — Vercel-cron-triggered job.
// ============================================================
// Runs at 10:00 IST every weekday (configured in vercel.json).
// Sends:
//   • One digest email per active exec/cm/admin/owner that has
//     an `email` field set. Lists overdue follow-ups + promises
//     due today + 90+ accounts they haven't called in 7 days.
//   • One owner-summary email to every owner user with: net
//     outstanding change since yesterday, biggest movers, who
//     didn't log a single call yesterday.
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` OR
//       Vercel cron's built-in user agent. Returns 401 otherwise.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { Resend } from 'resend';
import { query } from '@/lib/pg';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM           = process.env.EMAIL_FROM || 'Pushpak Portal <noreply@flypushpak.com>';
const CRON_SECRET    = process.env.CRON_SECRET;

const INR = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Cron-only entry. Vercel cron requests include their secret.
  const auth = req.headers.authorization || '';
  const ua   = String(req.headers['user-agent'] || '');
  const okAuth = (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) || ua.startsWith('vercel-cron');
  if (!okAuth) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  if (!RESEND_API_KEY) {
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set' });
  }
  const resend = new Resend(RESEND_API_KEY);

  const results: any = { execEmails: 0, ownerEmails: 0, errors: [] as string[] };

  // ─── Pull working data ────────────────────────────────────────
  const accounts = await query<any>(`
    SELECT party, exec, cm, bill::float8 AS bill,
           d90p::float8 AS d90p,
           "nextFu", "recentCall", "onHold", tier
      FROM "Account" WHERE bill > 0
  `);
  const promises = await query<any>(`
    SELECT party, exec, "expectedBy", "outstandingAt"::float8 AS outstanding, status
      FROM "Promise" WHERE status IN ('Open','Broken')
  `);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // ─── Per-exec digest ──────────────────────────────────────────
  const users = await query<any>(
    `SELECT id, "execId", name, role, email
       FROM "User" WHERE active = true
         AND role IN ('owner','admin','cm','exec')
         AND email IS NOT NULL AND email <> ''`
  );

  for (const u of users) {
    const email = u.email as string;
    const mine = accounts.filter(a => (a.exec || '').toUpperCase() === u.name.toUpperCase());
    const overdueFollow = mine.filter(a => a.nextFu && new Date(a.nextFu) <= today);
    const stuck90 = mine.filter(a =>
      a.d90p > 0 && (!a.recentCall || new Date(a.recentCall) < sevenDaysAgo)
    );
    const promisesDueToday = promises.filter(p =>
      (p.exec || '').toUpperCase() === u.name.toUpperCase() &&
      new Date(p.expectedBy) <= today
    );

    if (overdueFollow.length === 0 && stuck90.length === 0 && promisesDueToday.length === 0) continue;

    const subject = `Pushpak · Your worklist (${overdueFollow.length + promisesDueToday.length + stuck90.length} items)`;
    const html = renderExecDigest({
      name: u.name,
      overdueFollow, stuck90, promisesDueToday,
    });

    try {
      await resend.emails.send({ from: FROM, to: email, subject, html });
      results.execEmails++;
    } catch (e: any) {
      results.errors.push(`${u.name}: ${e.message}`);
    }
  }

  // ─── Owner summary ────────────────────────────────────────────
  const owners = users.filter(u => u.role === 'owner');
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const refreshDelta = await query<any>(`
    SELECT total::float8 AS total
      FROM "RefreshSnapshot"
     ORDER BY ts DESC LIMIT 7
  `);
  const latestTotal = Number(refreshDelta[0]?.total || 0);
  const prevTotal   = Number(refreshDelta[1]?.total || latestTotal);
  const netDelta = latestTotal - prevTotal;

  const callsYesterday = await query<any>(`
    SELECT exec, COUNT(*)::int AS n
      FROM "AccountHistory"
     WHERE source = 'Portal'
       AND action ILIKE 'call%'
       AND ts >= $1::timestamp AND ts < $2::timestamp
     GROUP BY exec
  `, [yesterday.toISOString(), today.toISOString()]);
  const calledNames = new Set(callsYesterday.map((c: any) => (c.exec || '').toUpperCase()));
  const silentExecs = users
    .filter(u => u.role === 'exec' || u.role === 'cm')
    .filter(u => !calledNames.has(u.name.toUpperCase()))
    .map(u => u.name);

  const biggestMovers = await query<any>(`
    SELECT party, amount::float8 AS amount, exec
      FROM "CollectionLog"
     WHERE date >= $1::date
     ORDER BY amount DESC LIMIT 5
  `, [yesterday.toISOString().slice(0, 10)]);

  for (const o of owners) {
    const email = o.email as string | null;
    if (!email) continue;
    const subject = `Pushpak Owner Summary · ${today.toLocaleDateString('en-IN', { dateStyle: 'medium' })}`;
    const html = renderOwnerSummary({
      latestTotal, netDelta,
      biggestMovers,
      silentExecs,
      accounts,
    });
    try {
      await resend.emails.send({ from: FROM, to: email, subject, html });
      results.ownerEmails++;
    } catch (e: any) {
      results.errors.push(`OWNER ${o.name}: ${e.message}`);
    }
  }

  return res.json({ ok: true, ...results });
}

// ─── Email render helpers ─────────────────────────────────────
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c
  ));
}

const FRAME_OPEN = `<!doctype html><html><body style="margin:0;padding:0;background:#F8F4EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F8F4EC;padding:24px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid rgba(15,40,85,0.08);">
        <tr><td style="background:linear-gradient(160deg,#1A3F7E,#0F2855);color:#fff;padding:22px 28px;">
          <div style="font-size:11px;letter-spacing:.3em;text-transform:uppercase;font-weight:700;opacity:0.7;">Pushpak Portal</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px;">__TITLE__</div>
        </td></tr>
        <tr><td style="padding:24px 28px;color:#0F2855;font-size:14px;line-height:1.55;">`;
const FRAME_CLOSE = `</td></tr>
        <tr><td style="padding:14px 28px;background:rgba(15,40,85,0.04);font-size:11px;color:#475569;border-top:1px solid rgba(15,40,85,0.06);">
          Sent by Pushpak Portal · <a href="https://app.flypushpak.com" style="color:#1A3F7E;text-decoration:none;">app.flypushpak.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

function frame(title: string, inner: string): string {
  return FRAME_OPEN.replace('__TITLE__', escapeHtml(title)) + inner + FRAME_CLOSE;
}

function section(label: string, items: string[]): string {
  if (items.length === 0) return '';
  return `
    <div style="margin-bottom:22px;">
      <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#475569;font-weight:700;margin-bottom:8px;">${escapeHtml(label)}</div>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:rgba(15,40,85,0.03);border-radius:8px;">
        ${items.map(i => `<tr><td style="padding:10px 14px;border-bottom:1px solid rgba(15,40,85,0.05);font-size:13px;">${i}</td></tr>`).join('')}
      </table>
    </div>`;
}

function renderExecDigest({ name, overdueFollow, stuck90, promisesDueToday }: any): string {
  const lines1 = overdueFollow.slice(0, 12).map((a: any) =>
    `<b>${escapeHtml(a.party)}</b> · ${INR(a.bill)} · follow-up ${new Date(a.nextFu).toLocaleDateString('en-IN')}`
  );
  const lines2 = promisesDueToday.slice(0, 12).map((p: any) =>
    `<b>${escapeHtml(p.party)}</b> · ${INR(p.outstanding)} promised by ${new Date(p.expectedBy).toLocaleDateString('en-IN')}`
  );
  const lines3 = stuck90.slice(0, 12).map((a: any) =>
    `<b>${escapeHtml(a.party)}</b> · ${INR(a.d90p)} stuck 90+ · last call ${a.recentCall ? new Date(a.recentCall).toLocaleDateString('en-IN') : 'never'}`
  );
  const total = overdueFollow.length + promisesDueToday.length + stuck90.length;
  const body = `
    <p style="margin:0 0 18px;font-size:15px;">Hi <b>${escapeHtml(name)}</b>, here's your worklist for today — <b>${total} item${total === 1 ? '' : 's'}</b> need your attention.</p>
    ${section('Overdue follow-ups',   lines1)}
    ${section('Promises due today',   lines2)}
    ${section('90+ stuck, no call in 7d', lines3)}
    <p style="margin:18px 0 0;font-size:12.5px;color:#475569;">
      Open the portal → <a href="https://app.flypushpak.com/portal/worklist" style="color:#1A3F7E;">My Worklist</a> to log calls, send WhatsApp reminders, or add promises.
    </p>
  `;
  return frame(`Your worklist · ${total} item${total === 1 ? '' : 's'}`, body);
}

function renderOwnerSummary({ latestTotal, netDelta, biggestMovers, silentExecs, accounts }: any): string {
  const deltaWord = netDelta === 0 ? 'unchanged' : netDelta < 0 ? `↓ ${INR(Math.abs(netDelta))} recovered` : `↑ ${INR(netDelta)} added`;
  const deltaColor = netDelta <= 0 ? '#2E6C54' : '#B5483D';
  const tierE = accounts.filter((a: any) => a.tier === 'E');
  const totalE = tierE.reduce((s: number, a: any) => s + Number(a.bill || 0), 0);

  const moversLines = biggestMovers.map((m: any) =>
    `<b>${escapeHtml(m.party)}</b> · ${INR(m.amount)} collected · ${escapeHtml(m.exec || '—')}`
  );
  const silentLines = silentExecs.slice(0, 15).map((n: string) =>
    `<b>${escapeHtml(n)}</b> — no calls logged yesterday`
  );

  const body = `
    <p style="margin:0 0 18px;font-size:15px;">Daily summary for <b>${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</b>:</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:22px;">
      <tr>
        <td style="padding:14px;background:rgba(15,40,85,0.06);border-radius:8px;width:48%;vertical-align:top;">
          <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#475569;font-weight:700;">Total Outstanding</div>
          <div style="font-size:22px;font-weight:700;color:#0F2855;margin-top:6px;">${INR(latestTotal)}</div>
          <div style="font-size:12px;color:${deltaColor};margin-top:4px;font-weight:600;">${deltaWord} vs prior snapshot</div>
        </td>
        <td style="width:4%;"></td>
        <td style="padding:14px;background:rgba(178,79,55,0.10);border-radius:8px;width:48%;vertical-align:top;">
          <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#475569;font-weight:700;">Tier E (legal)</div>
          <div style="font-size:22px;font-weight:700;color:#B5483D;margin-top:6px;">${INR(totalE)}</div>
          <div style="font-size:12px;color:#475569;margin-top:4px;font-weight:600;">${tierE.length} accounts</div>
        </td>
      </tr>
    </table>
    ${section('Biggest movers (last 24h)', moversLines)}
    ${section('Execs who didn\'t log a call yesterday', silentLines)}
    <p style="margin:18px 0 0;font-size:12.5px;color:#475569;">
      Open the portal → <a href="https://app.flypushpak.com/portal" style="color:#1A3F7E;">Dashboard</a> for the full picture.
    </p>
  `;
  return frame('Daily Owner Summary', body);
}
