// ============================================================
// /api/attendance/checkin — offsite self check-in (GPS-stamped).
// ============================================================
// Self-service for FIELD / second-location staff who never punch the
// office machine. Hard-scoped to the caller's own employee record
// (User.execId → Employee."loginExecId"), exactly like /api/leave and
// /api/attendance/mine — one user can never check in for another.
//
// GET  → the caller's offsite status: are they an offsite employee, are
//        they checked in today, plus this month's check-in history.
// POST { kind:'IN'|'OUT', lat, lng, accuracy?, note? }
//        → record a GPS check-in / check-out for TODAY and derive the
//          day's DailyAttendance row (source 'offsite') so payroll and
//          overtime pick it up. Only allowed for attendanceMode='offsite'.
//
// GPS coordinates are written server-side only (never echoed into a URL);
// the owner/HR see them on the Offsite review page. Every check-in is
// audited.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { query, queryOne, withTransaction, newId } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { deriveCheckinStatus, weekdayOf } from '@/lib/offsite';

const Body = z.object({
  kind: z.enum(['IN', 'OUT']),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().min(0).max(100000).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

// IST (UTC+5:30) calendar date / time-of-day for an instant. The portal's
// attendance is keyed to the local working day, so check-ins use IST.
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function istParts(d: Date): { iso: string; hhmm: string } {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const iso = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
  const hhmm = `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
  return { iso, hhmm };
}

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start, end: `${ny}-${String(nm).padStart(2, '0')}-01` };
}

async function findEmployee(execId: string) {
  return queryOne<any>(
    `SELECT id, name, "hrCode", department, "attendanceMode", "weeklyOffDay"
       FROM "Employee" WHERE "loginExecId" = $1 AND active = TRUE`,
    [execId],
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const emp = await findEmployee(user.execId);
  if (!emp) {
    if (req.method === 'GET') return res.json({ ok: true, linked: false });
    return res.status(400).json({ ok: false, error: "Your login isn't linked to an employee yet. Ask the owner to link it." });
  }

  if (req.method === 'GET') return getStatus(req, res, emp);
  if (req.method === 'POST') return record(req, res, user, emp);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

// ─── GET — own status + month history ────────────────────────────
async function getStatus(req: NextApiRequest, res: NextApiResponse, emp: any) {
  const { iso: todayIso } = istParts(new Date());
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
    ? String(req.query.month)
    : todayIso.slice(0, 7);
  const { start, end } = monthRange(month);

  // Today's raw events (to know if they're currently checked in).
  const todayEvents = await query<any>(
    `SELECT kind, "at", accuracy, note FROM "OffsiteCheckin"
      WHERE "employeeId" = $1 AND date = $2 ORDER BY "at"`,
    [emp.id, todayIso],
  );
  const ins = todayEvents.filter(e => e.kind === 'IN');
  const outs = todayEvents.filter(e => e.kind === 'OUT');

  // This month's derived offsite day rows (the history table).
  const days = await query<any>(
    `SELECT date, status, "actualIn", "actualOut", "isOvertime", remark
       FROM "DailyAttendance"
      WHERE "employeeId" = $1 AND date >= $2 AND date < $3 AND source = 'offsite'
      ORDER BY date DESC`,
    [emp.id, start, end],
  );

  return res.json({
    ok: true,
    linked: true,
    mode: emp.attendanceMode,
    isOffsite: emp.attendanceMode === 'offsite',
    employee: { name: emp.name, hrCode: emp.hrCode, department: emp.department },
    today: {
      iso: todayIso,
      checkedIn: ins.length > 0,
      checkedOut: outs.length > 0,
      ins: ins.length,
      outs: outs.length,
    },
    month,
    days,
  });
}

// ─── POST — record a check-in / check-out ────────────────────────
async function record(req: NextApiRequest, res: NextApiResponse, user: any, emp: any) {
  if (emp.attendanceMode !== 'offsite') {
    return res.status(400).json({ ok: false, error: 'Your attendance is recorded at the office machine, not self check-in. Ask the owner to switch you to offsite if you work in the field.' });
  }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad request', detail: parsed.error.flatten() });
  const b = parsed.data;

  const now = new Date();
  const { iso: todayIso, hhmm: nowHHMM } = istParts(now);

  try {
    await withTransaction(async (q) => {
      // 1. log the raw GPS event.
      await q(
        `INSERT INTO "OffsiteCheckin" (id, "employeeId", date, kind, "at", lat, lng, accuracy, note)
         VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8)`,
        [newId('chk'), emp.id, todayIso, b.kind, b.lat ?? null, b.lng ?? null, b.accuracy ?? null, b.note ?? null],
      );

      // 2. recompute the day's IN/OUT envelope from all of today's events.
      const events = await q(
        `SELECT kind, "at" FROM "OffsiteCheckin"
          WHERE "employeeId" = $1 AND date = $2 ORDER BY "at"`,
        [emp.id, todayIso],
      );
      const inTimes = events.filter((e: any) => e.kind === 'IN').map((e: any) => istParts(new Date(e.at)).hhmm);
      const outTimes = events.filter((e: any) => e.kind === 'OUT').map((e: any) => istParts(new Date(e.at)).hhmm);
      const actualIn = inTimes.length ? inTimes[0] : (b.kind === 'IN' ? nowHHMM : null);
      const actualOut = outTimes.length ? outTimes[outTimes.length - 1] : null;

      // 3. derive the day status (PRESENT, or OFF_DAY/HOLIDAY+overtime if
      //    they worked their weekly-off / a holiday).
      const isHolidayRows = await q(`SELECT 1 FROM "Holiday" WHERE date = $1 LIMIT 1`, [todayIso]);
      const isWeeklyOff = weekdayOf(todayIso) === Number(emp.weeklyOffDay);
      const { status, isOvertime } = deriveCheckinStatus({ isWeeklyOff, isHoliday: isHolidayRows.length > 0 });
      const remark = isOvertime
        ? (status === 'HOLIDAY' ? 'Offsite check-in on holiday (overtime)' : 'Offsite check-in on weekly-off (overtime)')
        : 'Offsite check-in';

      // 4. upsert the DailyAttendance row. Respect a human override: if the
      //    owner manually set this day, only refresh the punch envelope.
      const existing = (await q(
        `SELECT id, overridden FROM "DailyAttendance"
          WHERE "employeeId" = $1 AND date = $2 LIMIT 1`,
        [emp.id, todayIso],
      ))[0] as { id: string; overridden: boolean } | undefined;

      if (existing) {
        if (existing.overridden) {
          await q(
            `UPDATE "DailyAttendance" SET "actualIn" = $1, "actualOut" = $2, "updatedAt" = NOW() WHERE id = $3`,
            [actualIn, actualOut, existing.id],
          );
        } else {
          await q(
            `UPDATE "DailyAttendance" SET
               "actualIn" = $1, "actualOut" = $2, status = $3, "isInformed" = TRUE,
               "deductionDays" = 0, "isOvertime" = $4, remark = $5,
               source = 'offsite', "updatedAt" = NOW()
             WHERE id = $6`,
            [actualIn, actualOut, status, isOvertime, remark, existing.id],
          );
        }
      } else {
        await q(
          `INSERT INTO "DailyAttendance"
            (id, "employeeId", date, "actualIn", "actualOut", "lateByMin", "earlyGoingMin",
             "workDurMin", status, "isInformed", "deductionDays", remark, "isOvertime", source, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,0,0,0,$6,TRUE,0,$7,$8,'offsite',NOW(),NOW())`,
          [newId('att'), emp.id, todayIso, actualIn, actualOut, status, remark, isOvertime],
        );
      }
    });

    audit(req, user, 'OFFSITE_CHECKIN', emp.name, { kind: b.kind, date: todayIso, hasGps: b.lat != null && b.lng != null });
    return res.json({ ok: true, kind: b.kind, date: todayIso, at: nowHHMM });
  } catch (err: any) {
    console.error('[api/attendance/checkin] error', err);
    return res.status(500).json({ ok: false, error: err.message || 'Could not record check-in' });
  }
}
