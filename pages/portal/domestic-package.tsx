// ============================================================
// /portal/domestic-package — Domestic Package department (placeholder).
// ============================================================
// Reserved home for the domestic holidays / tour-package desk. The
// route, role and sidebar entry are wired; the workspace is next.
// ============================================================
import { ComingSoon } from '../../components/ComingSoon';

export default function DomesticPackagePage() {
  return (
    <ComingSoon
      title="Domestic Package"
      crumb="Domestic Package"
      blurb="The workspace for India holiday packages — itineraries, quotes and bookings — is being built. Your access is already set up; the tools land here soon."
      planned={[
        'Build & price domestic tour itineraries',
        'Send quotations to clients',
        'Track package bookings & payments',
        'Coordinate hotels, transport & sightseeing vendors',
      ]}
    />
  );
}
