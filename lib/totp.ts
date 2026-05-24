// ============================================================
// TOTP (2FA) — Google Authenticator / Authy compatible.
// ============================================================
import { authenticator } from 'otplib';
import qrcode from 'qrcode';

authenticator.options = {
  step: 30,
  window: 1, // accept codes from the previous/next 30s window (clock drift tolerance)
};

const ISSUER = process.env.TOTP_ISSUER || 'Pushpak Portal';

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildTotpUri(execId: string, secret: string): string {
  return authenticator.keyuri(execId, ISSUER, secret);
}

export async function buildTotpQr(execId: string, secret: string): Promise<string> {
  const uri = buildTotpUri(execId, secret);
  return qrcode.toDataURL(uri); // returns data:image/png;base64,...
}

export function verifyTotp(secret: string, token: string): boolean {
  return authenticator.check(token.replace(/\s/g, ''), secret);
}
