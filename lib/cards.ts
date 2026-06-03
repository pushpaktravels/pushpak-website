// ============================================================
// lib/cards.ts — the firm's credit cards + card-booking vocabulary.
// ============================================================
// Shared by the Card Booking API (validation) and the page (dropdowns), so
// the list of cards lives in exactly one place. Client-safe: no DB imports,
// so it can be bundled into the browser.
//
// These are the three HDFC cards described by the desk:
//   • Air India Express bookings
//   • IndiGo bookings + seat add-ons
//   • Miscellaneous expenses
// Add a card here (key + label) and it appears everywhere automatically.
// We store only the key — never a card number — so nothing sensitive leaks.
// ============================================================

export type CardDef = { key: string; label: string };

export const CARDS: CardDef[] = [
  { key: 'hdfc-airindia', label: 'HDFC · Air India Express' },
  { key: 'hdfc-indigo',   label: 'HDFC · IndiGo / Seats' },
  { key: 'hdfc-misc',     label: 'HDFC · Miscellaneous' },
];

export const CARD_KEYS = CARDS.map(c => c.key);
export const CARD_LABEL: Record<string, string> =
  Object.fromEntries(CARDS.map(c => [c.key, c.label]));

// What the card payment was for. Free enough to cover the desk's cases,
// tight enough to group/report on later.
export const CARD_PURPOSES = ['ticket', 'seat', 'baggage', 'meal', 'reissue', 'misc'] as const;
export type CardPurpose = typeof CARD_PURPOSES[number];

// Billing handoff state. 'unbilled' = waiting for accounts to raise the
// invoice; 'billed' = done; 'cancelled' = booking reversed / not billable.
export const CARD_STATUSES = ['unbilled', 'billed', 'cancelled'] as const;
export type CardStatus = typeof CARD_STATUSES[number];
