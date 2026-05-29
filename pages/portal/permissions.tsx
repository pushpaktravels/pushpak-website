// ============================================================
// /portal/permissions — RETIRED (redirects to Users & Authorities).
// ============================================================
// The portal used to carry a SECOND, DB-backed permission system here
// (Departments / Modules / Grants tabs, backed by lib/permissions.ts).
// It was never wired to the app's real pages or security gates, so
// creating a "department" or "module" had no visible effect — which is
// exactly why a department added here never appeared in the sidebar.
//
// Per the owner's decision (2026-05-30) we consolidated on a SINGLE
// system: "Users & Authorities" (/portal/users-auth), which controls
// per-user Visible / View-only rights for every real page. This route
// now redirects there so any old links or bookmarks keep working.
//
// The old API routes under /api/permissions/* and lib/permissions.ts
// remain on disk but are unreachable from the UI.
// ============================================================
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/portal/users-auth', permanent: false },
});

export default function PermissionsRetired() {
  return null;
}
