// ============================================================
// /portal/marketing — Marketing department (placeholder).
// ============================================================
// Reserved home for the marketing desk. The route, role and sidebar
// entry are wired; the campaigns / leads workspace is next.
// ============================================================
import { ComingSoon } from '../../components/ComingSoon';

export default function MarketingPage() {
  return (
    <ComingSoon
      title="Marketing"
      crumb="Marketing"
      blurb="The marketing workspace — campaigns, leads and promotions — is being built. Your access is already set up; the tools land here soon."
      planned={[
        'Plan & track campaigns across channels',
        'Capture & route incoming leads',
        'Schedule social posts & promotions',
        'Measure reach, spend & conversions',
      ]}
    />
  );
}
