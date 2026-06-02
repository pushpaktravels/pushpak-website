// ============================================================
// /portal/domestic-package — Domestic Package desk.
// ============================================================
// India holiday / tour-package workspace. Renders the shared PackageDesk
// component scoped to the 'domestic-package' department.
// ============================================================
import { PackageDesk } from '../../components/PackageDesk';

export default function DomesticPackagePage() {
  return <PackageDesk department="domestic-package" title="Domestic Package" crumb="Domestic Package" />;
}
