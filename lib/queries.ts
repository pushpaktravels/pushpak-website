// ============================================================
// lib/queries.ts — Forms/Queries module vocabulary (client-safe).
// ============================================================
// Replaces the loose Google Forms (Courier, Petrol, …) with one
// configurable in-portal module:
//   • A "query form" is a definition the OWNER edits — its fields, who may
//     FILL it (roles + which department headings it appears under), and who
//     may VIEW the responses (defaults to the accounts desk).
//   • A "query" is one filled submission. Accounts read it, add remarks,
//     CLASSIFY the related account (supplier / client / card / payment — the
//     module recommends one) and then PUSH or REJECT it.
//
// PUSH IS DRY-RUN: pushing only marks the query Accepted. Nothing posts to
// FinBook yet — see the FinBook dry-run list; reconnect when Calico is live.
//
// No DB imports here, so this is safe to bundle into the browser. The OTP /
// card form is deliberately NOT modelled here: we never store an OTP or card
// number (security rule) — card bookings live in the Card Bookings ledger.
// ============================================================

// ─── Field definitions (what a form asks for) ─────────────────
// 'file' = an upload slot rendered on the fill page; the bytes go to
// PortalFile (entityType='query', kind=field.key), the value itself isn't
// stored in the query JSON. 'account' is plain text the accounts desk links.
export type QueryFieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'account' | 'file';
export type QueryField = {
  key: string;
  label: string;
  type: QueryFieldType;
  required?: boolean;
  options?: string[];   // for 'select'
  help?: string;
};

// ─── How accounts file the related account ────────────────────
export const CLASSIFY_TYPES = ['supplier', 'client', 'card', 'payment'] as const;
export type ClassifyType = typeof CLASSIFY_TYPES[number];
export const CLASSIFY_LABEL: Record<string, string> = {
  supplier: 'Supplier / vendor',
  client: 'Client / debtor',
  card: 'Card',
  payment: 'Payment / expense',
};

// ─── Submission lifecycle ─────────────────────────────────────
// open → accepted (pushed, dry-run) | rejected. "accepted" does NOT write to
// FinBook yet; it only records that accounts cleared the query.
export const QUERY_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type QueryStatus = typeof QUERY_STATUSES[number];
export const QUERY_STATUS_LABEL: Record<string, string> = {
  open: 'Open', accepted: 'Accepted', rejected: 'Rejected',
};
export const QUERY_STATUS_COLOR: Record<string, string> = {
  open: '#C98A14', accepted: '#2E7D4F', rejected: '#B5483D',
};

// The form recommends a classification; accounts can override. Today this is
// just the form's default, but it's a single chokepoint so we can later make
// it smarter (e.g. match a typed name against known Accounts).
export function recommendClassify(
  form: { defaultClassify?: string | null },
): ClassifyType | null {
  const d = form.defaultClassify;
  return d && (CLASSIFY_TYPES as readonly string[]).includes(d) ? (d as ClassifyType) : null;
}

// 'all' = the form shows under every department's "Fill a Query" heading.
export const ALL_DEPTS = 'all';

// Map a role to the department "Fill a Query" heading it sits under, so a
// form pinned to specific departments (fillDepts) only shows to that desk's
// staff. Owner/admin see every form regardless (they manage the registry);
// support-staff have no department so they only ever see 'all' forms. Keep
// the slugs in lock-step with the Sidebar DEPARTMENTS list.
export const ROLE_DEPT: Record<string, string> = {
  'cm-accounts': 'accounts',
  'accounts': 'accounts',
  'hr': 'hr',
  'domestic-reservations': 'reservations',
  'domestic-package': 'domestic-package',
  'international-packages': 'international-packages',
  'visa': 'visa',
  'marketing': 'marketing',
  'insights': 'command',
};
export function roleDept(role: string): string | null {
  return ROLE_DEPT[role] || null;
}

// Can this role see a form given its fillDepts? 'all' (or an empty list) is
// universal; otherwise the role's department must be listed. Owner/admin are
// handled by the caller (they bypass).
export function formInDept(role: string, fillDepts: string[] | null | undefined): boolean {
  const depts = fillDepts && fillDepts.length ? fillDepts : [ALL_DEPTS];
  if (depts.includes(ALL_DEPTS)) return true;
  const d = roleDept(role);
  return !!d && depts.includes(d);
}

// Where a submitted form lands. Default (undefined/null) = a generic Query on
// the accounts "Queries" desk. 'vendor-payment' = the submission becomes a
// VendorPayment row instead, so the one Vendor Payments module is both the
// fill source (via Fill a Query) AND the single tracking place. This is the
// consolidation: employees just fill the form; accounts track everything in
// the Vendor Payments module — no parallel Queries-desk copy. Add more routes
// here as other Fill-a-Query forms get their own tracking module.
export type FormRoute = 'vendor-payment';

export type QueryFormDef = {
  key: string;
  title: string;
  description?: string;
  fields: QueryField[];
  fillRoles: string[];   // roles allowed to fill ([] = everyone)
  fillDepts: string[];   // department slugs it appears under, or ['all']
  viewRoles: string[];   // roles that see the responses (accounts desk + owner)
  defaultClassify: ClassifyType | null;
  routeTo?: FormRoute | null;  // null/absent → generic Query on the Queries desk
};

// Map a routed Vendor Payments submission's field values onto VendorPayment
// columns. Single source of truth so the API and any future re-router agree.
// File fields (bill, paymentReceipt) are NOT mapped here — they upload to
// PortalFile(entityType='vendor-payment') after the row is created.
export function vendorPaymentFromValues(values: Record<string, any>) {
  const v = values || {};
  const month = typeof v.forMonth === 'string' ? v.forMonth.trim() : '';
  const paid = typeof v.billPaid === 'string' ? v.billPaid.trim().toUpperCase() : '';
  const noteParts: string[] = [];
  if (month) noteParts.push(`For the month of ${month}`);
  if (paid) noteParts.push(`Bill paid (per submitter): ${paid}`);
  return {
    vendorName: (typeof v.vendor === 'string' && v.vendor.trim()) || 'Unspecified vendor',
    billNo: (typeof v.invoice === 'string' && v.invoice.trim()) || null,
    amount: Number(v.amount) || 0,
    billDate: (typeof v.billReceivedOn === 'string' && v.billReceivedOn) || null,
    purpose: month ? `For the month of ${month}` : null,
    notes: noteParts.length ? noteParts.join(' · ') : null,
  };
}

// Starter forms seeded on migration (owner can edit/extend/disable). Kept
// minimal + safe: no OTP/card-number capture. defaultClassify drives the
// accounts recommendation.
export const SEED_FORMS: QueryFormDef[] = [
  {
    key: 'courier',
    title: 'Courier dispatch',
    description: 'Log a courier/parcel sent out so accounts can book the courier charge.',
    fields: [
      { key: 'sentOn', label: 'Date sent', type: 'date', required: true },
      { key: 'party', label: 'Sent to (party)', type: 'account' },
      { key: 'courier', label: 'Courier company', type: 'text' },
      { key: 'docket', label: 'Docket / AWB no', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'purpose', label: 'What was sent', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    fillRoles: [],
    fillDepts: [ALL_DEPTS],
    viewRoles: ['owner', 'admin', 'cm-accounts', 'accounts'],
    defaultClassify: 'supplier',
  },
  {
    key: 'petrol',
    title: 'Petrol / fuel',
    description: 'Log a fuel expense for reimbursement / expense booking.',
    fields: [
      { key: 'filledOn', label: 'Date', type: 'date', required: true },
      { key: 'vehicle', label: 'Vehicle', type: 'text' },
      { key: 'litres', label: 'Litres', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'paidBy', label: 'Paid by', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    fillRoles: [],
    fillDepts: [ALL_DEPTS],
    viewRoles: ['owner', 'admin', 'cm-accounts', 'accounts'],
    defaultClassify: 'payment',
  },
  // ─── Billing for OTP (card billing record) ──────────────────
  // Reproduces the "Billing for OTP" Google Form. It records WHICH card was
  // used (last-4 selector only) + amount + details so accounts can book the
  // charge. It deliberately captures NO OTP and NO full card number — the OTP
  // is shared out-of-band and never stored (security rule). Visible to every
  // department.
  {
    key: 'billing-otp',
    title: 'Billing for OTP',
    description: 'Record a card billing so accounts can book it. Do not enter the OTP or full card number — only pick the card used.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'details', label: 'Details', type: 'text', required: true },
      {
        key: 'paymentMode', label: 'Payment mode (card used)', type: 'select', required: true,
        options: ['HDFC 8176 DINERS CLUB', 'HDFC 2666 VISA', 'AMEX 51005', 'AMEX 41000', 'INDUSIND 8681', 'HDFC 2235', 'Other'],
      },
      { key: 'service', label: 'Service', type: 'text' },
      { key: 'screenshot', label: 'Screenshot (if available)', type: 'file' },
    ],
    fillRoles: [],
    fillDepts: [ALL_DEPTS],
    viewRoles: ['owner', 'admin', 'cm-accounts', 'accounts'],
    defaultClassify: 'card',
  },
  // ─── Vendor Payments (vendor bill intake) ───────────────────
  // Reproduces the "Vendor Payments" Google Form: pick the vendor, attach the
  // bill (and receipt if already paid), and accounts book it against the
  // supplier. Vendor list mirrors the original form; edit it in the registry.
  {
    key: 'vendor-payments',
    title: 'Vendor Payments',
    description: 'Submit a vendor bill for payment / booking. Attach the bill (and the payment receipt if it is already paid).',
    routeTo: 'vendor-payment',
    fields: [
      {
        key: 'vendor', label: 'Vendor', type: 'select', required: true,
        options: [
          'VODAFONE', 'BSNL LANDLINE - 0361 2456789', 'JIO FIBER', 'JIO DIGITAL LIFE',
          'BSNL INTERNATIONAL - 9401337633', 'AIRTEL', 'VISHAL SIR PHONE', 'XYNOCAST',
          'BLUEDART', 'SIGNATURE MAINTAINANCE', 'N E HYGIENE', 'APDCL PAT GROUND FLOOR',
          'APDCL PAT 3RD FLOOR', 'APDCL DAYA SAGAR', 'APDCL SIGNATURE ESTATES',
          'PAT GROUND FLOOR MAINTAINANCE', 'PAT 3RD FLOOR MAINTAINANCE',
          'ZILLIOUS SOLUTIONS', 'LOKHNATH PRINTERS', 'Other',
        ],
      },
      { key: 'invoice', label: 'Invoice no. and details', type: 'text', required: true },
      { key: 'billReceivedOn', label: 'Bill received on', type: 'date', required: true },
      {
        key: 'forMonth', label: 'For the month of', type: 'select', required: true,
        options: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'bill', label: 'Bill', type: 'file', required: true },
      { key: 'billPaid', label: 'Bill paid?', type: 'select', options: ['YES', 'NO'] },
      { key: 'paymentReceipt', label: 'Payment receipt', type: 'file' },
    ],
    fillRoles: [],
    fillDepts: [ALL_DEPTS],
    viewRoles: ['owner', 'admin', 'cm-accounts', 'accounts'],
    defaultClassify: 'supplier',
  },
];
