// ============================================================
// lib/airlines.ts — the airlines the desk books, for the picker dropdowns.
// ============================================================
// Client-safe (no DB imports). The airline pickers on card bookings and
// reservations suggest from this list but also accept a free-typed name, so a
// charter / less-common carrier is never blocked. Keep IATA-ish short names so
// they group cleanly in reports later.
// ============================================================

export const AIRLINES: string[] = [
  'IndiGo',
  'Air India',
  'Air India Express',
  'Akasa Air',
  'SpiceJet',
  'Vistara',
  'Alliance Air',
  'Star Air',
  'FlyBig',
  'Emirates',
  'Qatar Airways',
  'Etihad Airways',
  'Singapore Airlines',
  'Thai Airways',
  'Malaysia Airlines',
  'Cathay Pacific',
  'British Airways',
  'Lufthansa',
];
