// ============================================================
// /portal/international-packages — International Packages (placeholder).
// ============================================================
// Reserved home for the overseas holidays / tour-package desk. The
// route, role and sidebar entry are wired; the workspace is next.
// ============================================================
import { ComingSoon } from '../../components/ComingSoon';

export default function InternationalPackagesPage() {
  return (
    <ComingSoon
      title="International Packages"
      crumb="International Packages"
      blurb="The workspace for overseas holiday packages — multi-city itineraries, vendor coordination and bookings — is being built. Your access is already set up; the tools land here soon."
      planned={[
        'Build & price international tour itineraries',
        'Multi-city & multi-country routing',
        'Coordinate overseas vendors & DMC partners',
        'Track package bookings, payments & documents',
      ]}
    />
  );
}
