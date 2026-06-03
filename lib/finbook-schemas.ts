// ============================================================
// lib/finbook-schemas.ts — exact request/response field shapes for the
// FinBook (Calico) API. Field names are copied VERBATIM from the live
// Swagger at calico.in/api (pulled 2026-06-02) so our payloads match
// what FinBook actually expects — do not "tidy" these names.
// ============================================================
// FinBook is the firm's accounting system. The portal integrates with it
// through exactly seven endpoints; this file is the single source of truth
// for their wire shapes. lib/finbook.ts (the client) builds and validates
// payloads against these types; everything else imports from there, never
// hand-rolls a FinBook body.
//
// Conventions observed in the Swagger examples:
//   • Almost every value is sent as a STRING, even amounts and counts.
//   • Dates are "YYYY-MM-DD HH:mm:ss" (FinBook local time, not ISO-Z).
//   • client_id is the accounting ledger id (e.g. "CCA000001");
//     client_web_id is the web-portal id (e.g. "CCL000001"). Sales,
//     receipts and journals reference BOTH.
//   • doc_prf is the document-prefix / voucher series (IW invoice-web,
//     RW receipt-web, JW journal-web, MW misc-web …).
//   • branchID / branch_ID is the FinBook branch ("00000001" = head office).
// ============================================================

// ─── Helpers ────────────────────────────────────────────────────
// FinBook wants "YYYY-MM-DD HH:mm:ss" in *local* time, not ISO with Z.
export function fbDateTime(d: Date | string = new Date()): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ` +
    `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`
  );
}
// clientledger wants plain "YYYY-MM-DD" for start/end dates.
export function fbDate(d: Date | string = new Date()): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// service_code values seen in the Swagger (Air Ticket "I", Bus "B"); the
// object families documented are Air / Bus / Hotel / Insurance / Car /
// Visa / Misc / Rail. We map our desks onto these when billing.
export type FbServiceCode = 'I' | 'B' | 'H' | 'V' | 'M' | 'R' | 'C' | 'INS';

// ─── 1) POST /clientmaster — create a client (agent / corporate) ──
export interface FbClientMasterBody {
  client_Name: string;
  branch_ID: string;
  client_Legal_Name?: string;
  isGroupAC?: 'Y' | 'N';
  corpID?: string;
  reseller_Mode?: 'Y' | 'N';
  pin?: string;
  contact_Person?: string;
  fax_no?: string;
  tax_Type?: string;
  tax_Code?: string;
  mobile_No?: string;
  telephone_No?: string;
  pan_No?: string;
  tan_No?: string;
  message?: string;
  groupID?: string;
  categoryID?: string;
  familyID?: string;
  locationID?: string;
  paymentTerm?: string;
  url?: string;
}

// ─── 2) POST /clientmaster (paxmaster) — add a passenger ──────────
export interface FbPaxMasterBody {
  paxName: string;
  branchID: string;
  clientID?: string;
  client_web_id?: string;
  pin?: string;
  gstCode?: string;
  taxType?: string;
  message?: string;
  category?: string;
  clientEmpCode?: string;
  costCenter?: string;
  countryID?: string;
  deptCode?: string;
  isActive?: string;
  mealPref?: string;
  mobileNo?: string;
  pan?: string;
  passPortexpiryDate?: string;
  passPortissueDate?: string;
  passPortNo?: string;
  passPortPlaceofIssue?: string;
  paxDOB?: string;
  paxDOW?: string;
  paxFrequentFlierID?: string;
  paxGender?: 'M' | 'F' | string;
  telphoneNO?: string;
  nationality?: string;
  fax?: string;
  categoryID?: string;
  creditLimit?: string;
  familyID?: string;
  groupID?: string;
  locationID?: string;
  salesPersonID?: string;
  defaultCurrency?: string;
  paymentTerm?: string;
}

// ─── 3) POST /salesdetails — itinerary → invoice/bill ─────────────
// ~90 fields in the Swagger Air Ticket example. The handful below are the
// ones we actually populate from a booking; the rest are optional and
// default empty on FinBook's side. All values go over the wire as strings.
export interface FbSalesDetailsBody {
  // identity / document
  doc_prf: string;            // voucher series, e.g. "IW"
  doc_nos: string;            // document number
  doc_srno?: number | string;
  service_code: FbServiceCode;
  doc_date: string;           // fbDateTime
  client_id: string;          // ledger id  ("CCA…")
  client_web_id: string;      // web id      ("CCL…")
  branchID: string;
  // routing / supplier
  supplier_id?: string;
  airline_id?: string;
  cost_id?: string;
  refr_key?: string;          // our idempotency / cross-ref key
  // ticket
  pnr_no?: string;
  ticketno?: string;
  org_ticketno?: string;
  pax?: string;
  sector?: string;
  fare_basis?: string;
  classType?: string;
  nos_pax_a?: string;
  nos_pax_c?: string;
  nos_pax_i?: string;
  flt_dtls1?: string; flt_dtls2?: string; flt_dtls3?: string; flt_dtls4?: string;
  flt_dtls5?: string; flt_dtls6?: string; flt_dtls7?: string;
  // money
  client_currency?: string;
  supplier_currency?: string;
  roe_client?: string;
  roe_supplier?: string;
  basic_fare?: string;
  fare_dtls?: string;
  yq_tax?: string; yr_tax?: string; jn_tax?: string; other_tax?: string; oc_tax?: string;
  client_comm?: string;
  supplier_comm?: string;
  client_srv1?: string;
  baggage_charges?: string;
  meal_charges?: string;
  seat_charges?: string;
  reissue_charges?: string;
  client_pay_type?: string;   // e.g. "CREDIT CARD"
  clientEmail?: string;
  issue_date?: string;
  custom_data?: string;
  web_ref?: string;
  // allow the long tail of optional FinBook fields without losing type help
  [k: string]: string | number | undefined;
}

// ─── 4) POST /retsceiptspayments — receipt / payment ──────────────
export interface FbReceiptBody {
  doc_prf: string;            // "RW"
  doc_nos: string;
  doc_srno?: string;
  amount: string;
  cashbank_id: string;        // which cash/bank account
  rctPyt: 'R' | 'P';          // Receipt or Payment
  bankName?: string;
  chequeNo?: string;
  chequeDate?: string;
  refr_key?: string;
  client_id: string;
  client_web_id?: string;
  branchID: string;
  paxName?: string;
  roe?: string;
  mob?: string;
  subLedgerID?: string;
  currency?: string;
  costCenterID?: string;
  tourID?: string;
  doc_date: string;
}

// ─── 5) POST /jrmaster (journal) — fund / journal entry ───────────
export interface FbJournalBody {
  debit_acc_id: string;
  credit_acc_id: string;
  branchID: string;
  amount: string;
  refr_key?: string;
  doc_prf: string;            // "JW"
  doc_nos?: string;
  roe?: string;
  subLedgerID?: string;
  paxName?: string;
  mob?: string;
  costCenterID?: string;
  tourID?: string;
  currency?: string;
  txnDate: string;
}

// ─── 6) GET /clientledger — statement ─────────────────────────────
export interface FbLedgerQuery {
  clientid: string;           // MUST start with 'C'
  startdate: string;          // fbDate
  enddate: string;            // fbDate
  year: string;
}
// FinBook returns a statement; we model the line shape loosely because the
// exact response keys aren't in the param docs. The reader normalises into
// FbLedgerLine[] so the UI is stable regardless of the raw shape.
export interface FbLedgerLine {
  date: string;
  docType: string;            // Invoice / Receipt / Journal …
  docNo: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
  refKey?: string;            // links a line back to our booking via refr_key
}
export interface FbLedger {
  clientId: string;
  clientName?: string;
  opening: number;
  closing: number;
  lines: FbLedgerLine[];
}

// ─── 7) GET /clientlimit/{clientid}[/{branchid}] — credit balance ─
export interface FbClientLimit {
  clientId: string;
  creditLimit: number;        // sanctioned limit
  outstanding: number;        // current dues
  available: number;          // limit − outstanding
  currency: string;
}
