// ============================================================
// /portal/international-packages — International Packages desk.
// ============================================================
// Overseas holiday / tour-package workspace. Renders the shared
// PackageDesk component scoped to the 'international-packages' department.
// ============================================================
import { PackageDesk } from '../../components/PackageDesk';

export default function InternationalPackagesPage() {
  return <PackageDesk department="international-packages" title="International Packages" crumb="International Packages" />;
}
