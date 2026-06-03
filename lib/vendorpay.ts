// ============================================================
// lib/vendorpay.ts — vendor-payment request vocabulary.
// ============================================================
// Shared by the Vendor Payments API (validation) and page (dropdowns), so
// the status flow + payment modes live in one place. Client-safe: no DB
// imports, so it can be bundled into the browser.
//
// The flow mirrors the desk's real process (replacing a Google Form +
// Excel): an employee RAISES a request → a manager (Shashank/Raunak)
// REVIEWS and approves or rejects → once approved the payment is MADE and
// recorded → finally accounts mark it BILLED. Portal-only; no FinBook (a
// later phase can post the approved payment into FinBook).
// ============================================================

export const VENDOR_STATUSES = ['requested', 'approved', 'rejected', 'paid', 'billed'] as const;
export type VendorStatus = typeof VENDOR_STATUSES[number];

export const VENDOR_STATUS_LABEL: Record<string, string> = {
  requested: 'Awaiting approval',
  approved: 'Approved — to pay',
  rejected: 'Rejected',
  paid: 'Paid',
  billed: 'Billed',
};
export const VENDOR_STATUS_COLOR: Record<string, string> = {
  requested: '#C98A14', approved: '#1A6FA8', rejected: '#B5483D', paid: '#2E7D4F', billed: '#2E7D4F',
};

// How the payment went out. Drives nothing yet; useful for reporting and
// (later) mapping to the right FinBook cash/bank account.
export const PAYMENT_MODES = ['bank', 'upi', 'cash', 'card', 'cheque'] as const;
export type PaymentMode = typeof PAYMENT_MODES[number];

// Only these roles may approve / reject / record payment. Raising a request
// and marking billed are open to any accounts staff with the view.
export const VENDOR_APPROVER_ROLES = new Set(['owner', 'admin', 'cm-accounts']);
