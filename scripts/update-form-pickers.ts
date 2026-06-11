// ============================================================
// One-shot migration: upgrade two already-seeded query forms to the new
// searchable pickers. add-queries.ts seeds with ON CONFLICT DO NOTHING, so a
// form that already exists never picks up later field changes from
// lib/queries.ts — this script applies just those two surgical edits:
//
//   • billing-otp   → add an "Account (billed to)" field (type 'account')
//                     right after Name, if it isn't already there. (item #8)
//   • vendor-payments → switch the "Vendor" field from a hard-coded 'select'
//                     to the searchable 'vendor' picker. (item #5)
//
// Surgical + idempotent: it reads each form's fields JSON, mutates only the
// one field, and writes it back — so it never disturbs other owner edits, and
// re-running is a no-op. Portal only; nothing here touches FinBook.
//
//   npx tsx scripts/update-form-pickers.ts
// ============================================================
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

type Field = { key: string; label: string; type: string; required?: boolean; options?: string[]; help?: string };

async function getFields(key: string): Promise<Field[] | null> {
  const r = await pool.query(`SELECT fields FROM "QueryForm" WHERE key = $1 LIMIT 1`, [key]);
  if (!r.rows.length) return null;
  const f = r.rows[0].fields;
  return Array.isArray(f) ? f : [];
}

async function setFields(key: string, fields: Field[]) {
  await pool.query(
    `UPDATE "QueryForm" SET fields = $1::jsonb, "updatedAt" = NOW() WHERE key = $2`,
    [JSON.stringify(fields), key],
  );
}

(async () => {
  // ── billing-otp: add the account field ─────────────────────
  const otp = await getFields('billing-otp');
  if (!otp) {
    console.log('• billing-otp not found (skipped) — run add-queries.ts first if it should exist.');
  } else if (otp.some(f => f.key === 'account')) {
    console.log('• billing-otp already has an "account" field — no change.');
  } else {
    const acct: Field = {
      key: 'account', label: 'Account (billed to)', type: 'account', required: true,
      help: 'Which client/account this booking was made for.',
    };
    // Insert right after "name" if present, else at the front.
    const at = otp.findIndex(f => f.key === 'name');
    const next = [...otp];
    next.splice(at >= 0 ? at + 1 : 0, 0, acct);
    await setFields('billing-otp', next);
    console.log('✓ billing-otp — added "Account (billed to)" field.');
  }

  // ── vendor-payments: vendor select → searchable picker ─────
  const vp = await getFields('vendor-payments');
  if (!vp) {
    console.log('• vendor-payments not found (skipped) — run add-queries.ts first if it should exist.');
  } else {
    const vi = vp.findIndex(f => f.key === 'vendor');
    if (vi < 0) {
      console.log('• vendor-payments has no "vendor" field — no change.');
    } else if (vp[vi].type === 'vendor') {
      console.log('• vendor-payments "vendor" field already uses the picker — no change.');
    } else {
      const next = [...vp];
      // Drop the stale hard-coded options; the picker reads the Vendor master.
      const { options, ...rest } = next[vi];
      next[vi] = { ...rest, type: 'vendor' };
      await setFields('vendor-payments', next);
      console.log('✓ vendor-payments — "Vendor" now uses the searchable picker.');
    }
  }

  await pool.end();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
