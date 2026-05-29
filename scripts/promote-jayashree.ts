// ============================================================
// promote-jayashree.ts — one-shot: promote JAYASHREE01 to admin
// + reset password + write the credentials to ~/Downloads.
// ============================================================
// SECURITY: the plaintext password is NEVER written to stdout. Only
// the resulting XLSX file contains it. Delete the file once she has
// signed in and changed her password.
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

// Same 12-char unambiguous-alphabet generator used by the bulk
// reset script. ~69 bits of entropy.
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
  const target = await pool.query(`SELECT id, "execId", name, role, "totpEnrolledAt", "lastLoginAt" FROM "User" WHERE "execId" = 'JAYASHREE01' LIMIT 1`);
  if (target.rows.length === 0) {
    console.error('JAYASHREE01 not found');
    process.exit(1);
  }
  const u = target.rows[0];
  console.log(`Current state: ${u.name} (${u.execId}) · role=${u.role} · 2FA enrolled=${!!u.totpEnrolledAt}`);

  // Confirm her accounts (sanity)
  const acc = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(bill),0)::float8 AS total FROM "Account" WHERE UPPER(exec) = $1 AND bill > 0`, [u.name.toUpperCase()]);
  console.log(`Her current book: ${acc.rows[0].n} owing accounts · ₹${Math.round(acc.rows[0].total).toLocaleString('en-IN')}`);

  // Generate + hash new password
  const plain = generatePassword();
  const hash  = await hashPassword(plain);

  // Promote + reset + clear viewPerms so she gets the admin role
  // defaults (otherwise any leftover exec-tailored view list would
  // restrict her).
  await pool.query(
    `UPDATE "User"
        SET role           = 'admin',
            "passwordHash" = $1,
            "failedAttempts" = 0,
            "lockedUntil"    = NULL,
            "viewPerms"      = ARRAY[]::text[],
            "viewReadOnly"   = ARRAY[]::text[],
            "updatedAt"      = NOW()
      WHERE id = $2`,
    [hash, u.id]
  );

  // Audit row so the change shows up under /portal/audit later.
  const auditId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await pool.query(
    `INSERT INTO "AuditLog" (id, ts, "userId", "execId", action, target, detail, ip, "userAgent")
     VALUES ($1, NOW(), NULL, 'SCRIPT', 'USER_PROMOTE', $2, $3, NULL, 'promote-jayashree.ts')`,
    [auditId, u.execId, JSON.stringify({ from: u.role, to: 'admin', passwordReset: true })]
  );

  // XLSX output
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Field', 'Value'],
    ['Name', u.name],
    ['Exec ID (sign in)', u.execId],
    ['Role', 'admin'],
    ['New password', plain],
    ['2FA enrolled?', u.totpEnrolledAt ? 'Yes — code still required' : 'No — she will be prompted to enrol on first sign-in'],
    ['Failed-attempts counter', 'reset to 0'],
    ['Account book', `${acc.rows[0].n} owing accounts · ₹${Math.round(acc.rows[0].total).toLocaleString('en-IN')}`],
    ['Issued at', new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })],
  ]);
  (ws as any)['!cols'] = [{ wch: 28 }, { wch: 56 }];
  XLSX.utils.book_append_sheet(wb, ws, 'JAYASHREE01');

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const outPath = path.join(os.homedir(), 'Downloads', `pushpak-jayashree-${stamp}.xlsx`);
  XLSX.writeFile(wb, outPath);
  try { fs.chmodSync(outPath, 0o600); } catch {}

  console.log('\n✓ Promotion complete.');
  console.log(`✓ Credentials written to: ${outPath}`);
  console.log('  (file permissions set to 0600 — readable only by you)\n');
  console.log('Reminder:');
  console.log('  • Hand the file (or just the new password) to Jayashree via a secure channel.');
  console.log('  • She still needs her existing 2FA code (if enrolled) AND the new password.');
  console.log('  • Delete the XLSX from disk once she has signed in & changed her password.');
  console.log('  • To further restrict / grant per-module access, use /portal/permissions.');

  await pool.end();
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
