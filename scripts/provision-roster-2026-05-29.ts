// ============================================================
// scripts/provision-roster-2026-05-29.ts
// ------------------------------------------------------------
// One-shot: give every staff member a login ID and the right role.
//
//   • Existing users  → role / badge updated in place. Passwords,
//                       2FA, team, scoreboard are NOT touched.
//   • New users       → created with a freshly-generated strong
//                       random password (active = true).
//
// SECURITY (matches scripts/reset-passwords.ts):
//   • Plaintext passwords are NEVER written to stdout / stderr.
//   • Only newly-created accounts land in an XLSX in ~/Downloads,
//     chmod 0600. Hand it out carefully and DELETE it once each
//     person has logged in and changed their password.
//   • Every create / role-change writes an AuditLog row tagged
//     'SCRIPT' so it shows up in the Owner's security review.
//
// Idempotent: re-running creates nothing new (everyone already
// exists → all become no-op role updates → no XLSX is written).
//
// Run with:
//   npx tsx scripts/provision-roster-2026-05-29.ts
// ============================================================
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as XLSX from 'xlsx';
import { hashPassword } from '../lib/password';
import type { RoleSlug } from '../lib/roles';

// Script-local client on DIRECT_URL (bypass the pgbouncer pooler).
const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
  log: ['error'],
});

// Followup views an `accounts` user gets by default — granted to Rita
// as a per-user override so she can work Followup while her primary
// role stays Domestic Reservations.
const FOLLOWUP_VIEWS = [
  'followup-dashboard', 'worklist', 'hold-check', 'promises',
  'payment-plans', 'legal', 'collections', 'performance',
];

type RosterEntry = {
  execId: string;
  name: string;
  role: RoleSlug;
  badge: string;
  team?: string[];        // only used when CREATING a new user
  scoreboard?: boolean;   // only used when CREATING a new user
  viewPerms?: string[];   // per-user override; applied on create AND update
  note?: string;          // human note, printed in the run log
};

const ROSTER: RosterEntry[] = [
  // ── ACCOUNTS TEAM ────────────────────────────────────────
  // Nikhil is the Collection Manager; the others are accounts staff.
  // (Dulu & Reeta are in this team day-to-day but stay `admin`, so
  //  they are intentionally omitted here — no downgrade.)
  { execId: 'NIKHIL01',  name: 'NIKHIL',  role: 'cm-accounts', badge: 'CM (Accounts)' },
  { execId: 'SASHANK01', name: 'SASHANK', role: 'accounts',    badge: 'Accounts' },
  { execId: 'RAUNAK01',  name: 'RAUNAK',  role: 'accounts',    badge: 'Accounts' },
  { execId: 'NIGAR01',   name: 'NIGAR',   role: 'accounts',    badge: 'Accounts' },
  { execId: 'TILAK01',   name: 'TILAK',   role: 'accounts',    badge: 'Accounts' },
  // Sengupta sits with the accounts team but is an admin (full access).
  { execId: 'SENGUPTA01', name: 'SENGUPTA', role: 'admin', badge: 'Admin', team: ['ALL'], scoreboard: true },

  // ── DOMESTIC RESERVATIONS (domestic ticketing) ───────────
  { execId: 'TAPOSHI01',   name: 'TAPOSHI RAY', role: 'domestic-reservations', badge: 'Domestic Res. (Head)', note: 'department head' },
  { execId: 'AMIT01',      name: 'AMIT CHAKRABORTY', role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'MILAN01',     name: 'MILAN DAS',     role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'SIMANTA01',   name: 'SIMANTA',       role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'KISHOR01',    name: 'KISHOR',        role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'DHIREN01',    name: 'DHIREN',        role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'RAHUL01',     name: 'RAHUL',         role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'RUPSHIKHA01', name: 'RUPSHIKHA',     role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'ARUP01',      name: 'ARUP KEOT-JORHAT', role: 'domestic-reservations', badge: 'Domestic Res.' },
  { execId: 'ANUP01',      name: 'ANUP DEB SIKDAR',  role: 'domestic-reservations', badge: 'Domestic Res.' },
  // Rita: primary Domestic Reservations, also helps in Followup → viewPerms.
  { execId: 'RITA01',  name: 'RITA BHASKARAN', role: 'domestic-reservations', badge: 'Domestic Res.',
    viewPerms: FOLLOWUP_VIEWS, note: 'cross-dept: also Followup (viewPerms granted)' },
  // Tenzin: primary Domestic Reservations, also in International Packages.
  // Intl has no built pages yet, so no extra viewPerms are needed today.
  { execId: 'TENZIN01', name: 'TENZIN', role: 'domestic-reservations', badge: 'Domestic Res. + Intl',
    note: 'cross-dept: also International Packages (no views to grant yet)' },

  // ── INTERNATIONAL PACKAGES ───────────────────────────────
  { execId: 'SAURAV01',  name: 'SAURAV',  role: 'international-packages', badge: 'Intl Pkg (Head)', note: 'department head' },
  { execId: 'MOHIT01',   name: 'MOHIT',   role: 'international-packages', badge: 'Intl Pkg' },
  { execId: 'MAUSAMI01', name: 'MAUSAMI', role: 'international-packages', badge: 'Intl Pkg' },
  { execId: 'LABANI01',  name: 'LABANI',  role: 'international-packages', badge: 'Intl Pkg' },

  // ── VISA ─────────────────────────────────────────────────
  { execId: 'MAKIBUR01', name: 'MAKIBUR', role: 'visa', badge: 'Visa' },
  { execId: 'JINTI01',   name: 'JINTI',   role: 'visa', badge: 'Visa' },

  // ── DOMESTIC PACKAGES ────────────────────────────────────
  { execId: 'DIPAK01',   name: 'DIPAK',   role: 'domestic-package', badge: 'Domestic Pkg' },
  { execId: 'DEEP01',    name: 'DEEP',    role: 'domestic-package', badge: 'Domestic Pkg' },
  { execId: 'VARSATI01', name: 'VARSATI', role: 'domestic-package', badge: 'Domestic Pkg' },

  // ── SUPPORT STAFF (no departmental views — Dashboard + Profile only) ──
  // Peons
  { execId: 'HARI01',  name: 'HARI',            role: 'support-staff', badge: 'Peon' },
  { execId: 'DAS01',   name: 'DAS',             role: 'support-staff', badge: 'Peon' },
  { execId: 'ADITYA01', name: 'ADITYA MAHATA',  role: 'support-staff', badge: 'Peon' },
  { execId: 'FEROZ01', name: 'MOHAMMAD FEROZ',  role: 'support-staff', badge: 'Peon' },
  // Drivers
  { execId: 'PATHAK01', name: 'PATHAK', role: 'support-staff', badge: 'Driver' },
  { execId: 'MRIDUL01', name: 'MRIDUL', role: 'support-staff', badge: 'Driver' },
  // Field collection staff
  { execId: 'RAJBONSHI01', name: 'RAJBONSHI', role: 'support-staff', badge: 'Field Collection' },
  { execId: 'SATYA01',     name: 'SATYA',     role: 'support-staff', badge: 'Field Collection' },
  { execId: 'DWIJEN01',    name: 'DWIJEN',    role: 'support-staff', badge: 'Field Collection' },
  // Front desk
  { execId: 'ANJU01', name: 'ANJU', role: 'support-staff', badge: 'Front Desk' },
  // IT
  { execId: 'PRADIP01', name: 'PRADIP', role: 'support-staff', badge: 'IT' },
];

// 12 chars from an unambiguous alphabet, dashed every 4 for readability.
// Excludes 0/O, 1/l/I. ~69 bits of entropy.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generatePassword(): string {
  const buf = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHA[buf[i] % ALPHA.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

async function main() {
  // Guard against duplicate exec IDs in the roster above.
  const ids = ROSTER.map(r => r.execId);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length) throw new Error(`Duplicate execId(s) in ROSTER: ${[...new Set(dupes)].join(', ')}`);

  // Look everyone up first.
  const existing = await prisma.user.findMany({
    where: { execId: { in: ids } },
    select: { id: true, execId: true, role: true, badge: true },
  });
  const byExec = new Map(existing.map(u => [u.execId, u]));

  type Created = { execId: string; name: string; role: string; badge: string; plain: string; hash: string };
  type Updated = { execId: string; name: string; fromRole: string; toRole: string; badge: string };

  const toCreate: Created[] = [];
  const toUpdate: Updated[] = [];

  for (const e of ROSTER) {
    const hit = byExec.get(e.execId);
    if (hit) {
      toUpdate.push({ execId: e.execId, name: e.name, fromRole: hit.role, toRole: e.role, badge: e.badge });
    } else {
      const plain = generatePassword();
      const hash = await hashPassword(plain);
      toCreate.push({ execId: e.execId, name: e.name, role: e.role, badge: e.badge, plain, hash });
    }
  }

  console.log(`Roster: ${ROSTER.length} people — ${toCreate.length} to create, ${toUpdate.length} to update.\n`);

  // Apply everything in one transaction so it's all-or-nothing.
  await prisma.$transaction(async (tx) => {
    for (const e of ROSTER) {
      const hit = byExec.get(e.execId);
      if (hit) {
        await tx.user.update({
          where: { execId: e.execId },
          data: {
            role: e.role,
            badge: e.badge,
            ...(e.viewPerms ? { viewPerms: e.viewPerms } : {}),
            ...(e.team ? { team: e.team } : {}),
            ...(e.scoreboard !== undefined ? { scoreboard: e.scoreboard } : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            execId: 'SCRIPT', action: 'USER_ROLE_UPDATE', target: e.execId,
            userAgent: 'provision-roster-2026-05-29.ts',
            detail: JSON.stringify({
              from: hit.role, to: e.role, badge: e.badge,
              ...(e.viewPerms ? { viewPerms: e.viewPerms } : {}),
            }),
          },
        });
        console.log(`  ~ ${e.execId.padEnd(12)} ${hit.role} → ${e.role}${e.note ? `   (${e.note})` : ''}`);
      } else {
        const c = toCreate.find(x => x.execId === e.execId)!;
        await tx.user.create({
          data: {
            execId: e.execId, name: e.name, passwordHash: c.hash,
            role: e.role, badge: e.badge,
            team: e.team ?? [], scoreboard: e.scoreboard ?? false,
            viewPerms: e.viewPerms ?? [], active: true,
          },
        });
        await tx.auditLog.create({
          data: {
            execId: 'SCRIPT', action: 'USER_PROVISION_CREATE', target: e.execId,
            userAgent: 'provision-roster-2026-05-29.ts',
            detail: JSON.stringify({ role: e.role, badge: e.badge }),
          },
        });
        console.log(`  + ${e.execId.padEnd(12)} created as ${e.role}${e.note ? `   (${e.note})` : ''}`);
      }
    }

    // Summary audit row.
    await tx.auditLog.create({
      data: {
        execId: 'SCRIPT', action: 'ROSTER_PROVISIONED', target: 'User',
        userAgent: 'provision-roster-2026-05-29.ts',
        detail: JSON.stringify({
          created: toCreate.map(c => c.execId),
          updated: toUpdate.map(u => u.execId),
        }),
      },
    });
  }, {
    // ~70 round-trips over the Supabase direct connection — well past
    // Prisma's 5s interactive-transaction default. Give it room.
    maxWait: 15000,
    timeout: 120000,
  });

  // Write credentials for newly-created users only.
  if (toCreate.length) {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Exec ID', 'Name', 'Role', 'Badge', 'Password (change on first login)'],
      ...toCreate.map(c => [c.execId, c.name, c.role, c.badge, c.plain]),
    ]);
    (sheet as any)['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, sheet, 'New Logins');

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const outPath = path.join(os.homedir(), 'Downloads', `pushpak-new-logins-${stamp}.xlsx`);
    XLSX.writeFile(wb, outPath);
    try { fs.chmodSync(outPath, 0o600); } catch {}

    console.log(`\n✓ ${toCreate.length} new login(s) written to: ${outPath}`);
    console.log(`  (file permissions 0600 — readable only by you)`);
  } else {
    console.log(`\n✓ No new accounts — nothing written to disk.`);
  }

  console.log(`\nDone. ${toUpdate.length} role update(s), ${toCreate.length} new account(s).`);
  if (toCreate.length) {
    console.log('Reminders:');
    console.log('  • New users have NO 2FA yet — they enroll on first login.');
    console.log('  • Tell each person to change their password on first login.');
    console.log('  • Delete the XLSX from disk once everyone has logged in.');
  }
}

main()
  .catch(e => { console.error('Provisioning failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
