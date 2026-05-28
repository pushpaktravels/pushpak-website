// Idempotent additions to support PII masking + IP allowlist:
//   • Setting rows for idle-timeout + owner IP allowlist + WhatsApp templates
//   • No new tables needed — audit + setting already exist
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

const DEFAULTS: Array<[string, string, string]> = [
  ['SESSION_IDLE_MINUTES', '30',  'security'],
  ['PII_MASK_ENABLED',     'true','security'],
  ['WA_TPL_GENTLE',
    'Dear {owner}, this is a gentle reminder from Pushpak Travels regarding your outstanding of ₹{outstanding} on account {party}, pending for {days} days. Kindly arrange payment at your earliest convenience. Thank you. — {exec}',
    'whatsapp'],
  ['WA_TPL_FIRM',
    'Dear {owner}, this is a firm reminder from Pushpak Travels. Your outstanding of ₹{outstanding} on account {party} is overdue by {days} days. Please clear the dues immediately to avoid further escalation. — {exec}',
    'whatsapp'],
  ['WA_TPL_LEGAL',
    'Dear {owner}, despite repeated reminders, ₹{outstanding} is still outstanding on {party} ({days} days overdue). This is a final notice from Pushpak Travels before legal proceedings are initiated. Please settle the dues within 7 days. — {exec}',
    'whatsapp'],
  ['WA_TPL_PROMISE_BROKEN',
    'Dear {owner}, the payment promise for ₹{outstanding} on {party} was not honoured on the expected date. Kindly clarify the new payment date at the earliest. — {exec}, Pushpak Travels',
    'whatsapp'],
  ['WA_TPL_PAYMENT_RECEIVED',
    'Dear {owner}, we acknowledge receipt of your payment toward {party}. Current outstanding balance: ₹{outstanding}. Thank you for your cooperation. — {exec}, Pushpak Travels',
    'whatsapp'],
];

(async () => {
  for (const [key, value, category] of DEFAULTS) {
    await pool.query(
      `INSERT INTO "Setting" (key, value, category, "updatedAt", "updatedBy")
       VALUES ($1, $2, $3, NOW(), 'security-tables.ts')
       ON CONFLICT (key) DO NOTHING`,
      [key, value, category]
    );
  }
  console.log(`Seeded ${DEFAULTS.length} security + WhatsApp template Settings (skip-on-conflict).`);
  await pool.end();
})();
