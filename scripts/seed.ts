// ============================================================
// Seed initial users into Postgres.
// Run with: npm run seed
// ============================================================
// Idempotent — re-running won't duplicate. Uses execId as the key.
// Passwords here MUST be changed by each user on first login (we'll
// add a forced-rotation flow in Phase 2). For now, defaults match
// the legacy roster.
// ============================================================
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';
import type { RoleSlug } from '../lib/roles';

// Use a script-local Prisma client wired to DIRECT_URL (bypasses the Supabase
// pgbouncer pooler, which fights with prepared statements during loops).
const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
  log: ['error'],
});

type Seed = {
  execId: string;
  name: string;
  password: string;
  role: RoleSlug;
  badge: string;
  team: string[];
  scoreboard: boolean;
};

const USERS: Seed[] = [
  // Owners
  { execId: 'VANSHIKA01', name: 'VANSHIKA',   password: 'Vanshika@2026',  role: 'owner', badge: 'Owner', team: ['ALL'], scoreboard: false },
  { execId: 'VISHAL01',   name: 'VISHAL SIR', password: 'Vishal@2026',    role: 'owner', badge: 'Owner', team: ['ALL'], scoreboard: false },
  // Admins
  { execId: 'DULU01',     name: 'DULU',       password: 'Dulu@2026',      role: 'admin', badge: 'Admin', team: ['ALL'], scoreboard: true },
  { execId: 'REETA01',    name: 'REETA',      password: 'Reeta@2026',     role: 'admin', badge: 'Admin', team: ['ALL'], scoreboard: true },
  // CMs
  { execId: 'NIKHIL01',   name: 'NIKHIL',     password: 'Nikhil@2026',    role: 'cm-accounts', badge: 'Collection Manager',
    team: ['NIKHIL','TAPOSHI RAY','SIMANTA'], scoreboard: true },
  // Rita is primarily Domestic Reservations but also helps in Followup
  // (workload low) — her cross-dept Followup access is granted via viewPerms
  // by scripts/provision-roster-2026-05-29.ts, not by role.
  { execId: 'RITA01',     name: 'RITA BHASKARAN', password: 'Rita@2026',  role: 'domestic-reservations', badge: 'Domestic Res.',
    team: ['RAHUL','ANUP DEB SIKDAR','DHIREN','KISHOR','RITA BHASKARAN','RUPSHIKHA','TENZIN','ARUP KEOT-JORHAT'], scoreboard: true },
  // Accounts team — Nikhil is the CM (cm-accounts); the rest are accounts staff.
  { execId: 'SASHANK01',  name: 'SASHANK',  password: 'Sashank@2026',  role: 'accounts',    badge: 'Accounts', team: ['SASHANK'],  scoreboard: false },
  { execId: 'RAUNAK01',   name: 'RAUNAK',   password: 'Raunak@2026',   role: 'accounts',    badge: 'Accounts', team: ['RAUNAK'],   scoreboard: false },
  { execId: 'SENGUPTA01', name: 'SENGUPTA', password: 'Sengupta@2026', role: 'admin',       badge: 'Admin',    team: ['ALL'],       scoreboard: true  },
  { execId: 'NIGAR01',    name: 'NIGAR',    password: 'Nigar@2026',    role: 'accounts',    badge: 'Accounts', team: ['NIGAR'],    scoreboard: false },
  { execId: 'TILAK01',    name: 'TILAK',    password: 'Tilak@2026',    role: 'accounts',    badge: 'Accounts', team: ['TILAK'],    scoreboard: false },
  // ── Executives (own-accounts-only scope) ──
  { execId: 'TAPOSHI01',   name: 'TAPOSHI RAY',             password: 'Taposhi@2026',   role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'SIMANTA01',   name: 'SIMANTA',                 password: 'Simanta@2026',   role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'RAHUL01',     name: 'RAHUL',                   password: 'Rahul@2026',     role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'ANUP01',      name: 'ANUP DEB SIKDAR',         password: 'Anup@2026',      role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'DHIREN01',    name: 'DHIREN',                  password: 'Dhiren@2026',    role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'KISHOR01',    name: 'KISHOR',                  password: 'Kishor@2026',    role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'RUPSHIKHA01', name: 'RUPSHIKHA',               password: 'Rupshikha@2026', role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'TENZIN01',    name: 'TENZIN',                  password: 'Tenzin@2026',    role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'ARUP01',      name: 'ARUP KEOT-JORHAT',        password: 'Arup@2026',      role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'ANKITA01',    name: 'ANKITA MUDAI',            password: 'Ankita@2026',    role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'MILAN01',     name: 'MILAN DAS',               password: 'Milan@2026',     role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'AMIT01',      name: 'AMIT CHAKRABORTY',        password: 'Amit@2026',      role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'ANSARI01',    name: 'ANSARI',                  password: 'Ansari@2026',    role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'BASANT01',    name: 'BASANTJI KHETAN-JORHAT',  password: 'Basant@2026',    role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'JAYASHREE01', name: 'JAYASHREE HAZARIKA',      password: 'Jayashree@2026', role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'KOLKATA01',   name: 'KOLKATA OFFICE',          password: 'Kolkata@2026',   role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'BISHU01',     name: 'BISHU TASHILDER',         password: 'Bishu@2026',     role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'JAYANTA01',   name: 'JAYANTAA BHATTACHARJEE',  password: 'Jayanta@2026',   role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'NANDA01',     name: 'NANDA DUTTA MAZUMDER',    password: 'Nanda@2026',     role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'PRABIR01',    name: 'PRABIR SEN GUPTA',        password: 'Prabir@2026',    role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'PRAVESH01',   name: 'PRAVESH AGARWAL',         password: 'Pravesh@2026',   role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'TILOK01',     name: 'TILOK PAUL',              password: 'Tilok@2026',     role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
  { execId: 'VISHESH01',   name: 'VISHESH SIR',             password: 'Vishesh@2026',   role: 'domestic-reservations', badge: 'Executive', team: [], scoreboard: false },
];

async function main() {
  for (const u of USERS) {
    const passwordHash = await hashPassword(u.password);
    await prisma.user.upsert({
      where: { execId: u.execId },
      update: {
        // Don't clobber existing password / 2FA on re-seed
        name: u.name, role: u.role, badge: u.badge,
        team: u.team, scoreboard: u.scoreboard,
      },
      create: {
        execId: u.execId,
        name: u.name,
        passwordHash,
        role: u.role,
        badge: u.badge,
        team: u.team,
        scoreboard: u.scoreboard,
        active: true,
      },
    });
    console.log(`✓ ${u.execId} (${u.role})`);
  }
  console.log(`\nSeeded ${USERS.length} users.`);
  console.log('Default passwords are in seed.ts. Tell users to change them on first login (rotation flow lands in Phase 2).');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
