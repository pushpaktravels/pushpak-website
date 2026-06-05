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
export type QueryFieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'account';
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

export type QueryFormDef = {
  key: string;
  title: string;
  description?: string;
  fields: QueryField[];
  fillRoles: string[];   // roles allowed to fill ([] = everyone)
  fillDepts: string[];   // department slugs it appears under, or ['all']
  viewRoles: string[];   // roles that see the responses (accounts desk + owner)
  defaultClassify: ClassifyType | null;
};

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
];
