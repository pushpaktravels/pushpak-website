// ============================================================
// /api/attendance/offsite — owner/HR review of offsite staff.
// ============================================================
// GET ?month=YYYY-MM
//   → for every offsite employee, a day-by-day grid for the month:
//     their GPS check-ins (in/out time + location + accuracy) and the
//     auto-filled gaps (weekly-off / holiday / leave / ABSENT) for the
//     elapsed working days they didn't check in. Plus a month tally.
//
// This is the verification surface for self check-in: it's where the
// owner sees WHO checked in, WHEN, and from WHERE. GPS is read here
// (server-side, owner/HR only) — never exposed to the executives.
//
// Auth: 'offsite' view (owner / admin / hr). Read-only.
// ============================================================
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/pg';
import { requireAuth } from '@/lib/auth';
import { requireView } from '@/lib/views';
import { deriveMissingStatus, weekdayOf, type OffsiteGridDay } from '@/lib/offsite';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function istIso(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}
function istHHMM(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}
function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start, end: `${ny}-${String(nm).padStart(2, '0')}-01` };
}
function daysInCalendarMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

type EmpCounts = {
  present: number; absent: number; leave: number; halfDay: number;
  offDay: number; holiday: number; overtime: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!requireView(user, res, 'offsite')) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ ok: false, error: 'month query param (YYYY-MM) required' });
  }
  const { start, end } = monthRange(month);
  const daysInMonth = daysInCalendarMonth(month);
  const todayIso = istIso(new Date());
  const [yy, mm] = month.split('-').map(Number);

  const employees = await query<any>(
    `SELECT id, name, "hrCode", department, "weeklyOffDay", "joiningDate"
       FROM "Employee"
      WHERE active = TRUE AND "attendanceMode" = 'offsite'
      ORDER BY department NULLS LAST, name`,
  );
  if (employees.length === 0) return res.json({ ok: true, month, todayIso, rows: [], totalCheckins: 0 });

  const empIds = employees.map(e => e.id);

  // Holidays in the month.
  const hols = await query<any>(`SELECT date FROM "Holiday" WHERE date >= $1 AND date < $2`, [start, end]);
  const holidaySet = new Set(hols.map(h => (typeof h.date === 'string' ? h.date.slice(0, 10) : istIso(new Date(h.date)))));

  // Real attendance rows for the month (check-ins + any manual overrides).
  const rows = await query<any>(
    `SELECT "employeeId", date, status, "actualIn", "actualOut", "isOvertime", source, overridden
       FROM "DailyAttendance"
      WHERE "employeeId" = ANY($1::text[]) AND date >= $2 AND date < $3`,
    [empIds, start, end],
  );
  const rowByEmpDate = new Map<string, any>();
  for (const r of rows) {
    const iso = typeof r.date === 'string' ? r.date.slice(0, 10) : istIso(new Date(r.date));
    rowByEmpDate.set(`${r.employeeId}|${iso}`, { ...r, iso });
  }

  // GPS from the day's first IN event (where they started).
  const events = await query<any>(
    `SELECT "employeeId", date, kind, "at", lat, lng, accuracy, note
       FROM "OffsiteCheckin"
      WHERE "employeeId" = ANY($1::text[]) AND date >= $2 AND date < $3
      ORDER BY "at"`,
    [empIds, start, end],
  );
  const gpsByEmpDate = new Map<string, { lat: number | null; lng: number | null; accuracy: number | null; note: string | null; inAt: string | null; outAt: string | null }>();
  for (const e of events) {
    const iso = typeof e.date === 'string' ? e.date.slice(0, 10) : istIso(new Date(e.date));
    const key = `${e.employeeId}|${iso}`;
    const cur = gpsByEmpDate.get(key) || { lat: null, lng: null, accuracy: null, note: null, inAt: null, outAt: null };
    if (e.kind === 'IN') {
      if (cur.inAt === null) { // first IN holds the GPS we show
        cur.inAt = istHHMM(new Date(e.at));
        cur.lat = e.lat; cur.lng = e.lng; cur.accuracy = e.accuracy; cur.note = e.note;
      }
    } else if (e.kind === 'OUT') {
      cur.outAt = istHHMM(new Date(e.at)); // last OUT wins (events are time-ordered)
    }
    gpsByEmpDate.set(key, cur);
  }
  const totalCheckins = events.filter(e => e.kind === 'IN').length;

  // Approved leaves overlapping the month → per-emp date → FULL/HALF.
  const leaves = await query<any>(
    `SELECT "employeeId", "fromDate", "toDate", kind FROM "LeaveRequest"
      WHERE status = 'APPROVED' AND "employeeId" = ANY($1::text[])
        AND "fromDate" < $3 AND "toDate" >= $2`,
    [empIds, start, end],
  );
  const leaveByEmpDate = new Map<string, 'FULL' | 'HALF'>();
  for (const l of leaves) {
    const from = typeof l.fromDate === 'string' ? l.fromDate.slice(0, 10) : istIso(new Date(l.fromDate));
    const to = typeof l.toDate === 'string' ? l.toDate.slice(0, 10) : istIso(new Date(l.toDate));
    const kind = l.kind === 'HALF_DAY' ? 'HALF' : (l.kind === 'FULL_DAY' || l.kind === 'PERIOD_LEAVE' ? 'FULL' : null);
    if (!kind) continue; // ON_DUTY / late / early don't make a gap-day a leave
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${yy}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (iso >= from && iso <= to) leaveByEmpDate.set(`${l.employeeId}|${iso}`, kind);
    }
  }

  const out = employees.map(emp => {
    const joiningIso = emp.joiningDate
      ? (typeof emp.joiningDate === 'string' ? emp.joiningDate.slice(0, 10) : istIso(new Date(emp.joiningDate)))
      : null;
    const counts: EmpCounts = { present: 0, absent: 0, leave: 0, halfDay: 0, offDay: 0, holiday: 0, overtime: 0 };
    const days: OffsiteGridDay[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${yy}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const future = iso > todayIso;
      const beforeJoin = !!(joiningIso && iso < joiningIso);
      const real = rowByEmpDate.get(`${emp.id}|${iso}`);
      const gps = gpsByEmpDate.get(`${emp.id}|${iso}`);

      let status: string;
      let isOvertime = false;
      let source: OffsiteGridDay['source'] = 'derived';

      if (real) {
        status = real.status;
        isOvertime = !!real.isOvertime;
        source = real.source === 'offsite' ? 'offsite' : (real.source === 'leave' ? 'leave' : 'other');
      } else if (future || beforeJoin) {
        status = '';                       // not counted, blank cell
        source = 'derived';
      } else {
        status = deriveMissingStatus({
          isWeeklyOff: weekdayOf(iso) === Number(emp.weeklyOffDay),
          isHoliday: holidaySet.has(iso),
          leave: leaveByEmpDate.get(`${emp.id}|${iso}`) ?? null,
        });
        source = (status === 'LEAVE' || status === 'HALF_DAY') ? 'leave' : 'derived';
      }

      // tally (skip future / pre-join blanks)
      if (status) {
        switch (status) {
          case 'PRESENT': case 'LATE': counts.present++; break;
          case 'ABSENT': counts.absent++; break;
          case 'LEAVE': counts.leave++; break;
          case 'HALF_DAY': counts.halfDay++; break;
          case 'OFF_DAY': counts.offDay++; break;
          case 'HOLIDAY': counts.holiday++; break;
          case 'ON_DUTY': counts.present++; break;
        }
        if (isOvertime) counts.overtime++;
      }

      days.push({
        date: iso, status, isOvertime, source,
        inAt: gps?.inAt ?? (real?.actualIn ?? null),
        outAt: gps?.outAt ?? (real?.actualOut ?? null),
        lat: gps?.lat ?? null, lng: gps?.lng ?? null, accuracy: gps?.accuracy ?? null,
        note: gps?.note ?? null,
        future: future || beforeJoin,
      });
    }

    return {
      employeeId: emp.id, name: emp.name, hrCode: emp.hrCode, department: emp.department,
      counts, days,
    };
  });

  return res.json({ ok: true, month, todayIso, rows: out, totalCheckins });
}
