// ============================================================
// lib/billing.ts — map a portal booking → a FinBook sales bill.
// ============================================================
// Phase 3 (auto-billing) turns "the reservation executive puts details in
// the portal" into "a bill is generated in FinBook". This module is the
// pure MAPPER: it takes a Reservation row and produces the exact
// FbSalesDetailsBody that /salesdetails expects — no network, no DB. The
// billing API route calls finbook.addSalesDetail() with what we build here.
//
// SERVER-ONLY by convention (only the billing API imports it). It depends
// only on lib/finbook-schemas (pure wire types + date helpers), so it never
// pulls in pg or process.env.
//
// SAFETY — idempotency: every bill carries a deterministic refr_key derived
// from the booking id (billRefKey). FinBook (and our PortalBill outbox) key
// on it, so generating the same booking twice can never create two bills.
// ============================================================
import { fbDateTime, type FbSalesDetailsBody, type FbServiceCode } from './finbook-schemas';

// The shape we read off a Reservation row (only the fields billing needs).
export interface BillableReservation {
  id: string;
  pnr?: string | null;
  passengerName: string;
  paxCount?: number | null;
  sector: string;
  airline?: string | null;
  travelDate?: string | Date | null;
  fareAmount?: number | string | null;
  vendor?: string | null;
}

// Extra context the desk/account supplies that the booking itself doesn't
// carry yet (the Reservation module is stand-alone — not linked to a FinBook
// client). Until that link exists, the operator picks the ledger to bill to.
export interface BillContext {
  branchId: string;
  clientId: string;        // FinBook ledger id ("CCA…") — who is billed
  clientWebId?: string;    // FinBook web id ("CCL…")
  docPrefix?: string;      // voucher series; defaults "IW" (invoice-web)
  docNo?: string;          // optional pre-assigned document number
  serviceCode?: FbServiceCode; // defaults 'I' (air ticket)
  payType?: string;        // CASH / CREDIT / CREDIT CARD …
}

// Deterministic cross-reference / idempotency key for a booking's bill.
// Stored on the FinBook payload (refr_key) AND as the unique key of our
// PortalBill outbox, so a booking maps to exactly one bill.
export function billRefKey(reservationId: string): string {
  return `RSV:${reservationId}`;
}

function s(v: unknown): string {
  if (v == null) return '';
  return String(v);
}
function money(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n as number) ? (n as number).toFixed(2) : '0.00';
}

// Build the /salesdetails body for a booking. Everything goes over the wire
// as a string (FinBook convention). Unmapped optional fields are simply
// omitted — FinBook defaults them — so we only send what we genuinely know.
export function reservationToSalesDetail(
  rsv: BillableReservation,
  ctx: BillContext,
): FbSalesDetailsBody {
  const travel = rsv.travelDate ? new Date(rsv.travelDate) : null;
  const body: FbSalesDetailsBody = {
    doc_prf:       ctx.docPrefix || 'IW',
    doc_nos:       s(ctx.docNo),                 // blank → FinBook/dry-run assigns
    service_code:  ctx.serviceCode || 'I',       // 'I' = air ticket
    doc_date:      fbDateTime(new Date()),
    client_id:     ctx.clientId,
    client_web_id: ctx.clientWebId || '',
    branchID:      ctx.branchId,
    refr_key:      billRefKey(rsv.id),
    pnr_no:        s(rsv.pnr),
    pax:           rsv.passengerName,
    sector:        rsv.sector,
    nos_pax_a:     s(rsv.paxCount ?? 1),
    basic_fare:    money(rsv.fareAmount),
    fare_dtls:     money(rsv.fareAmount),
    client_pay_type: ctx.payType || '',
    // We store the travel sector/date in the first flight-detail slot so it
    // shows on the FinBook invoice even before we map structured legs.
    flt_dtls1:     travel ? `${rsv.sector} ${fbDateTime(travel).slice(0, 10)}` : rsv.sector,
  };
  if (rsv.airline) body.airline_id = rsv.airline;   // name now; real id mapping later
  if (rsv.vendor) body.supplier_id = rsv.vendor;    // name now; real id mapping later
  return body;
}

// A short, human label for the booking shown in the billing console + audit.
export function reservationBillLabel(rsv: BillableReservation): string {
  return `${rsv.passengerName} · ${rsv.sector}${rsv.pnr ? ` · PNR ${rsv.pnr}` : ''}`;
}
