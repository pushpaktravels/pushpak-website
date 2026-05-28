// ============================================================
// lib/mask.ts — PII masking helpers used everywhere the portal
// renders phone numbers / emails / addresses.
// ============================================================
// Masking is server-side by default. The reveal flow is:
//   1. List views render maskPhone(value) — only last 4 visible.
//   2. Drawer Contact tab shows a "Show full" link per field.
//   3. Click → POST /api/clients/[party]/reveal — writes an
//      AuditLog entry (PII_REVEAL) + returns the unmasked value.
//
// This way every reveal is recorded with userId / IP / timestamp,
// so if someone exfiltrates contact data we can prove it.
// ============================================================

// "+91 98XXX XX111" — keep country code + first 2 + last 3
export function maskPhone(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v).trim();
  if (s.length < 6) return s;            // too short to mask
  // Capture trailing digits (last 3) + leading visible chunk
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6) return s;
  const last3 = digits.slice(-3);
  // Preserve any country-code prefix that includes '+'
  const m = s.match(/^(\+?\d{1,3})[\s-]?(\d{2})/);
  if (m) {
    return `${m[1]} ${m[2]}XXX XX${last3}`;
  }
  // Fallback: just mask middle
  return `${s.slice(0, 2)}XXX XX${last3}`;
}

// "a***@example.com" — keep first letter + domain
export function maskEmail(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v).trim();
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at);
  if (local.length <= 1) return s;
  return `${local[0]}${'*'.repeat(Math.max(2, local.length - 1))}${domain}`;
}

// "##### Address line 1" — first 4 chars only of any line
export function maskAddress(v: string | null | undefined): string {
  if (!v) return '—';
  return v.split('\n').map(line => {
    const t = line.trim();
    if (t.length <= 4) return t;
    return `${t.slice(0, 4)}${'•'.repeat(Math.min(8, t.length - 4))}`;
  }).join('\n');
}

// Convenience: a single ClientMaster row that's been masked.
export function maskClient<T extends {
  phone1?: string | null; phone2?: string | null;
  whatsapp?: string | null; email?: string | null;
  address?: string | null;
}>(c: T): T {
  return {
    ...c,
    phone1:   c.phone1   ? maskPhone(c.phone1)     : c.phone1,
    phone2:   c.phone2   ? maskPhone(c.phone2)     : c.phone2,
    whatsapp: c.whatsapp ? maskPhone(c.whatsapp)   : c.whatsapp,
    email:    c.email    ? maskEmail(c.email)      : c.email,
    address:  c.address  ? maskAddress(c.address)  : c.address,
  };
}
