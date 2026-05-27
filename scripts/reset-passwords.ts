// ============================================================
// scripts/reset-passwords.ts — reset every user's password to a
// freshly-generated strong random string and write the credentials
// to an XLSX in ~/Downloads.
// ============================================================
// SECURITY:
//   • Plaintext passwords are NEVER written to stdout / stderr.
//   • Only the resulting XLSX file contains them. Distribute it
//     carefully and delete it from disk once everyone has logged in.
//   • Each user also has failedAttempts reset to 0 + lockedUntil
//     cleared, so the new password works on first try.
//   • 2FA enrollment is preserved (totpSecret untouched) — users
//     still need their authenticator code after typing the new pw.
//
// Run with:
//   npx tsx scripts/reset-passwords.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as XLSX from 'xlsx';
import { hashPassword } from '../lib/password';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

// 12 chars from an unambiguous alphabet, dashed every 4 for readability.
// Alphabet excludes 0/O, 1/l/I — common typo sources.
// log2(55^12) ≈ 69 bits of entropy. Very strong for a portal login.
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
  console.log('Loading users…');
  const r = await pool.query<any>(
    `SELECT id, "execId", name, role, badge, active, scoreboard,
            "totpEnrolledAt", "lastLoginAt"
       FROM "User"
      WHERE active = true
   ORDER BY
     CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'cm' THEN 3 WHEN 'exec' THEN 4 ELSE 5 END,
     name`
  );
  const users = r.rows;
  console.log(`  ${users.length} active users.`);

  if (users.length === 0) {
    console.log('No active users — nothing to do.');
    await pool.end();
    return;
  }

  // Generate + hash up front so any failure happens before we write.
  type Row = { id: string; execId: string; name: string; role: string; badge: string;
               totpEnrolled: boolean; lastLogin: string;
               plain: string; hash: string };
  const all: Row[] = [];
  for (const u of users) {
    const plain = generatePassword();
    const hash  = await hashPassword(plain);
    all.push({
      id: u.id, execId: u.execId, name: u.name, role: u.role,
      badge: u.badge || '',
      totpEnrolled: !!u.totpEnrolledAt,
      lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 16).replace('T', ' ') : 'never',
      plain, hash,
    });
  }

  // Update inside a transaction so all-or-nothing.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of all) {
      await client.query(
        `UPDATE "User"
            SET "passwordHash" = $1,
                "failedAttempts" = 0,
                "lockedUntil"    = NULL,
                "updatedAt"      = NOW()
          WHERE id = $2`,
        [row.hash, row.id]
      );
    }
    // Best-effort audit row tagged so it shows up in Owner's security review.
    const auditId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await client.query(
      `INSERT INTO "AuditLog" (id, ts, "userId", "execId", action, target, detail, ip, "userAgent")
       VALUES ($1, NOW(), NULL, 'SCRIPT', 'PASSWORD_RESET_BULK', NULL, $2, NULL, 'reset-passwords.ts')`,
      [auditId, JSON.stringify({ count: all.length, execIds: all.map(a => a.execId) })]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Write XLSX to ~/Downloads
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Exec ID', 'Name', 'Role', 'Badge', 'New Password', '2FA Enrolled', 'Last Login'],
    ...all.map(r => [r.execId, r.name, r.role, r.badge, r.plain, r.totpEnrolled ? 'Yes' : 'No', r.lastLogin]),
  ]);
  // Column widths so the file looks tidy when she opens it
  (sheet as any)['!cols'] = [
    { wch: 14 }, { wch: 22 }, { wch: 9 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, sheet, 'New Credentials');

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const outPath = path.join(os.homedir(), 'Downloads', `pushpak-passwords-${stamp}.xlsx`);
  XLSX.writeFile(wb, outPath);

  // Tighten file permissions so other OS users can't read it
  try { fs.chmodSync(outPath, 0o600); } catch {}

  console.log(`\n✓ Updated ${all.length} user${all.length === 1 ? '' : 's'}.`);
  console.log(`✓ Credentials written to: ${outPath}`);
  console.log(`  (file permissions set to 0600 — readable only by you)`);
  console.log(`\nReminder:`);
  console.log(`  • Each user must use BOTH the new password AND their existing 2FA code to log in.`);
  console.log(`  • Failed-attempts counters reset to 0, so accounts are unlocked.`);
  console.log(`  • Delete the XLSX from disk once everyone has logged in & changed their password.`);

  await pool.end();
}

main().catch(err => { console.error('Reset failed:', err); process.exit(1); });
