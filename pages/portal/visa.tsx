// ============================================================
// /portal/visa — Visa department (placeholder).
// ============================================================
// Reserved home for the visa desk. The route, role and sidebar
// entry are wired; the application-tracking workspace is next.
// ============================================================
import { ComingSoon } from '../../components/ComingSoon';

export default function VisaPage() {
  return (
    <ComingSoon
      title="Visa"
      crumb="Visa"
      blurb="The visa desk workspace — applications, document checklists and appointment tracking — is being built. Your access is already set up; the tools land here soon."
      planned={[
        'Log visa applications by traveller & country',
        'Document checklist & collection tracking',
        'Appointment & biometric scheduling',
        'Status pipeline (applied → granted / rejected)',
      ]}
    />
  );
}
