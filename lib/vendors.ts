// ============================================================
// lib/vendors.ts — the vendor/supplier master vocabulary (client-safe).
// ============================================================
// Before this, the canonical vendor list lived hard-coded as the options of
// the "Vendor Payments" query form — so it couldn't be searched, reused on a
// booking, or extended without editing code. Now vendors live in the "Vendor"
// table (one master); this file holds the SEED list used to populate it on
// migration and any shared constants. No DB imports here, so it is safe to
// bundle into the browser.
//
// The pickers everywhere allow a FREE-TEXT fallback (type a name not yet in
// the master) so no one is ever blocked — adding it to the master is a
// separate, permissioned action.
// ============================================================

export type Vendor = {
  id: string;
  name: string;
  contact?: string | null;
  gstin?: string | null;
  notes?: string | null;
  active: boolean;
};

// The original "Vendor Payments" Google-Form vendor list. Seeded once on
// migration; the owner/accounts desk grow it from the Vendors page after that.
// 'Other' is deliberately excluded — the free-text fallback covers it.
export const SEED_VENDORS: string[] = [
  'VODAFONE',
  'BSNL LANDLINE - 0361 2456789',
  'JIO FIBER',
  'JIO DIGITAL LIFE',
  'BSNL INTERNATIONAL - 9401337633',
  'AIRTEL',
  'VISHAL SIR PHONE',
  'XYNOCAST',
  'BLUEDART',
  'SIGNATURE MAINTAINANCE',
  'N E HYGIENE',
  'APDCL PAT GROUND FLOOR',
  'APDCL PAT 3RD FLOOR',
  'APDCL DAYA SAGAR',
  'APDCL SIGNATURE ESTATES',
  'PAT GROUND FLOOR MAINTAINANCE',
  'PAT 3RD FLOOR MAINTAINANCE',
  'ZILLIOUS SOLUTIONS',
  'LOKHNATH PRINTERS',
];
