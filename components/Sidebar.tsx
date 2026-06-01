// ============================================================
// Sidebar — role-aware nav, per-ID overrides (Vishal minimal,
// Vanshika no My Worklist), collapses empty section labels.
// ============================================================
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { INSIGHTS_ONLY_EXEC_IDS } from '../lib/roles';
import { INSIGHTS_ONLY_VIEWS } from '../lib/views';

export type CurrentUser = {
  id: string;
  execId: string;
  name: string;
  role: string;
  badge: string;
  viewPerms?: string[] | null;
  viewReadOnly?: string[] | null;
  // Live, owner-editable default views for this user's role (from /api/me).
  // Used when the user has no per-user viewPerms, so the nav matches the
  // server gate after a role default changes.
  roleViews?: string[] | null;
  mustChangePassword?: boolean;
};

type Dept = 'command' | 'personal' | 'followup' | 'reservations'
  | 'domestic-package' | 'international-packages' | 'visa' | 'marketing'
  | 'hr' | 'settings';
type NavItem = { view: string; label: string; roles: string[]; href: string; icon: ReactNode; dept: Dept };
type NavSection = { label: string; items: NavItem[]; roles: string[] };

// Department labels for the top-of-sidebar dropdown. Owner sees all
// departments; everyone else only sees a department if at least one
// item in it is visible to them (driven by role + viewPerms). Personal
// is the default landing for every user — every employee sees it.
const DEPARTMENTS: { slug: Dept; label: string }[] = [
  { slug: 'command',                label: 'Command Center' },
  { slug: 'personal',               label: 'Personal' },
  { slug: 'followup',               label: 'Followup' },
  { slug: 'reservations',           label: 'Domestic Reservations' },
  { slug: 'domestic-package',       label: 'Domestic Package' },
  { slug: 'international-packages',  label: 'International Packages' },
  { slug: 'visa',                   label: 'Visa' },
  { slug: 'marketing',              label: 'Marketing' },
  { slug: 'hr',                     label: 'HR' },
  { slug: 'settings',               label: 'Settings' },
];

const SECTIONS: NavSection[] = [
  // ─── COMMAND CENTER (owner-only executive overview) ───────────
  {
    label: 'Executive',
    roles: ['owner'],
    items: [
      { view: 'overview', label: 'Command Center', href: '/portal/overview', roles: ['owner'], dept: 'command', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 12l5-3"/></svg> },
    ],
  },

  // ─── PERSONAL department (default landing for every user) ─────
  {
    label: 'Me',
    roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'],
    items: [
      { view: 'dashboard', label: 'Dashboard',  href: '/portal',         roles: ['owner','admin','cm-accounts','accounts','insights'], dept: 'personal', icon: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> },
      { view: 'messages',  label: 'Messages',   href: '/portal/messages', roles: ['owner','admin','cm-accounts','accounts','insights'], dept: 'personal', icon: <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"/></svg> },
      // Owner-only covert chat oversight. Lives in Personal (per owner's
      // preference) but is hard-gated to the owner in canSee() below — it
      // must NEVER surface to any exec. Eye icon to distinguish from chat.
      { view: 'messages-admin', label: 'Message Oversight', href: '/portal/messages-admin', roles: ['owner'], dept: 'personal', icon: <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg> },
      { view: 'profile',   label: 'My Profile', href: '/portal/profile', roles: ['owner','admin','cm-accounts','accounts','insights'], dept: 'personal', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg> },
    ],
  },

  // ─── FOLLOWUP department (collections / accounts work) ────────
  {
    label: 'Operations',
    roles: ['owner', 'admin', 'cm-accounts', 'accounts'],
    items: [
      { view: 'followup-dashboard', label: 'Followup Dashboard', href: '/portal/followup',      roles: ['owner','admin','cm-accounts','accounts','insights'], dept: 'followup', icon: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> },
      { view: 'worklist',           label: 'My Worklist',        href: '/portal/worklist',      roles: ['owner','admin','cm-accounts','accounts'],           dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
      { view: 'team-worklist',      label: 'Team Worklist',      href: '/portal/team-worklist', roles: ['owner','admin','cm-accounts'],                  dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { view: 'hold-check',         label: 'Hold Check',         href: '/portal/hold-check',    roles: ['owner','admin','cm-accounts','accounts'],           dept: 'followup', icon: <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> },
    ],
  },
  {
    label: 'Ledgers',
    roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'],
    items: [
      { view: 'families',      label: 'Clients & Families', href: '/portal/families',     roles: ['owner','admin'],                       dept: 'followup', icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M15 14h2a4 4 0 0 1 4 4v3"/></svg> },
      { view: 'promises',      label: 'Promise Ledger',     href: '/portal/promises',     roles: ['owner','admin','cm-accounts','accounts'],           dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 14l2 2 4-4"/></svg> },
      { view: 'payment-plans', label: 'Doubtful Ledger',    href: '/portal/payment-plans', roles: ['owner','admin','cm-accounts','accounts'],           dept: 'followup', icon: <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg> },
      { view: 'legal',         label: 'Legal Ledger',       href: '/portal/legal',        roles: ['owner','admin','cm-accounts','accounts','insights'], dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7l8-4z"/></svg> },
      { view: 'collections',   label: 'Collection List',    href: '/portal/collections',  roles: ['owner','admin','cm-accounts','accounts','insights'], dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h12"/><circle cx="19" cy="18" r="2.5"/></svg> },
    ],
  },
  {
    label: 'Insights',
    roles: ['owner', 'admin', 'cm-accounts', 'accounts', 'insights'],
    items: [
      { view: 'performance', label: 'Performance', href: '/portal/performance', roles: ['owner','admin','cm-accounts','accounts'], dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> },
      { view: 'scoreboard',  label: 'Scoreboard',  href: '/portal/scoreboard',  roles: ['owner','admin','cm-accounts'],         dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M6 9h12M6 15h12M4 5l16 0v14H4z"/></svg> },
      { view: 'insights',    label: 'Insights',    href: '/portal/insights',    roles: ['owner','insights'],            dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/></svg> },
    ],
  },
  {
    label: 'Data & Operations',
    roles: ['owner', 'admin'],
    items: [
      { view: 'upload',  label: 'Upload & Refresh',    href: '/portal/upload',  roles: ['owner','admin'], dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg> },
      { view: 'bulk-cm', label: 'Bulk CM Assignment',  href: '/portal/bulk-cm', roles: ['owner','admin'], dept: 'followup', icon: <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
    ],
  },

  // ─── RESERVATIONS department (domestic booking desk) ──────────
  {
    label: 'Bookings',
    roles: ['owner', 'admin', 'domestic-reservations'],
    items: [
      { view: 'reservations',          label: 'Reservations',   href: '/portal/reservations',          roles: ['owner','admin','domestic-reservations'], dept: 'reservations', icon: <svg viewBox="0 0 24 24"><path d="M2 16l20-5-7 9-2-4-4 1zM2 16l9-3"/><path d="M11 13l5-7"/></svg> },
      { view: 'reservations-dues',     label: 'Payment Dues',   href: '/portal/reservations-dues',     roles: ['owner','admin','domestic-reservations'], dept: 'reservations', icon: <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg> },
      { view: 'reservations-worklist', label: 'My Worklist',    href: '/portal/reservations-worklist', roles: ['owner','admin','domestic-reservations'], dept: 'reservations', icon: <svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
      { view: 'reservations-performance', label: 'Desk Performance', href: '/portal/reservations-performance', roles: ['owner','admin'], dept: 'reservations', icon: <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> },
    ],
  },

  // ─── UPCOMING departments (placeholder workspaces) ────────────
  // Each is a single "coming soon" landing so the department appears in
  // the dropdown and its staff land somewhere real. Swap the item's href
  // target page from <ComingSoon> to the real module when it's built.
  {
    label: 'Domestic Package',
    roles: ['owner', 'admin', 'domestic-package'],
    items: [
      { view: 'domestic-package', label: 'Package Desk', href: '/portal/domestic-package', roles: ['owner','admin','domestic-package'], dept: 'domestic-package', icon: <svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg> },
    ],
  },
  {
    label: 'International Packages',
    roles: ['owner', 'admin', 'international-packages'],
    items: [
      { view: 'international-packages', label: 'Package Desk', href: '/portal/international-packages', roles: ['owner','admin','international-packages'], dept: 'international-packages', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9z"/></svg> },
    ],
  },
  {
    label: 'Visa',
    roles: ['owner', 'admin', 'visa'],
    items: [
      { view: 'visa', label: 'Visa Desk', href: '/portal/visa', roles: ['owner','admin','visa'], dept: 'visa', icon: <svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/></svg> },
    ],
  },
  {
    label: 'Marketing',
    roles: ['owner', 'admin', 'marketing'],
    items: [
      { view: 'marketing', label: 'Marketing', href: '/portal/marketing', roles: ['owner','admin','marketing'], dept: 'marketing', icon: <svg viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a3 3 0 0 1 0 6"/></svg> },
    ],
  },

  // ─── HR department ────────────────────────────────────────────
  {
    label: 'People',
    roles: ['owner', 'admin'],
    items: [
      { view: 'attendance', label: 'Attendance', href: '/portal/attendance', roles: ['owner','admin','hr'], dept: 'hr', icon: <svg viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 16l2 2 4-4"/></svg> },
      { view: 'employees',  label: 'Employees',  href: '/portal/employees',  roles: ['owner','admin','hr'], dept: 'hr', icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87"/></svg> },
      { view: 'payroll',    label: 'Payroll',    href: '/portal/payroll',    roles: ['owner','admin','hr'], dept: 'hr', icon: <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/></svg> },
    ],
  },

  // ─── SETTINGS department (governance / admin) ─────────────────
  {
    label: 'Governance',
    roles: ['owner'],
    items: [
      { view: 'users-auth',  label: 'Users & Authorities', href: '/portal/users-auth',  roles: ['owner'],         dept: 'settings', icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M3 21c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9.5" r="2.5"/></svg> },
      { view: 'audit',       label: 'Audit Log',           href: '/portal/audit',       roles: ['owner'],         dept: 'settings', icon: <svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg> },
      { view: 'activity',    label: 'Activity & Time',     href: '/portal/activity',    roles: ['owner','admin'], dept: 'settings', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> },
      { view: 'settings',    label: 'Settings',            href: '/portal/settings',    roles: ['owner','admin'], dept: 'settings', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/></svg> },
    ],
  },
];

function canSee(item: NavItem, user: CurrentUser): boolean {
  // Personal department is the default landing for every employee —
  // Dashboard + My Profile + Messages are never gated by role overrides
  // or viewPerms. The one exception: the insights-only executive (Vishal)
  // is a pure spectator, so he gets Dashboard + Profile but NOT chat —
  // mirrors lib/views.ts canAccessView.
  if (item.dept === 'personal') {
    // Covert chat oversight lives in Personal (per owner's preference) but
    // is the ONE personal item that is NOT universal — it must never surface
    // to any exec, so it is hard-gated to the owner regardless of the
    // personal-dept bypass below.
    if (item.view === 'messages-admin') return user.role === 'owner';
    if (INSIGHTS_ONLY_EXEC_IDS.has(user.execId)) {
      return item.view === 'dashboard' || item.view === 'profile';
    }
    return true;
  }

  // Insights-only identities (e.g. Vishal) see ONLY their pinned views —
  // checked BEFORE the owner bypass so it holds even if their row says
  // 'owner'. Mirrors lib/views.ts canAccessView exactly. Vishal logs in to
  // see the Command Center (firm overview); everything else stays hidden.
  if (INSIGHTS_ONLY_EXEC_IDS.has(user.execId)) {
    return INSIGHTS_ONLY_VIEWS.has(item.view);
  }

  // Owner always sees everything. viewPerms is meant for restricting
  // non-owner roles; the owner is the one who SETS those restrictions
  // so they should never be restricted themselves. This also keeps the
  // sidebar working when new views are added to the codebase — owners
  // get the new entries automatically without needing to re-edit their
  // own permissions row.
  if (user.role === 'owner') return true;

  // Explicit per-user override (set in Users & Authorities) wins for
  // every non-owner role.
  if (user.viewPerms && user.viewPerms.length > 0) {
    return user.viewPerms.includes(item.view);
  }
  // Otherwise the role's LIVE default views decide (owner-editable; comes
  // from /api/me as roleViews). Falls back to the item's hard-coded roles
  // if roleViews wasn't supplied (e.g. a stale cached user) so the nav
  // never empties out unexpectedly.
  if (user.roleViews) {
    return user.roleViews.includes(item.view);
  }
  if (!item.roles.includes(user.role)) return false;
  return true;
}

// Is `href` the active route for `pathname`? Matches the exact page or a
// real sub-path (href + '/'), but NEVER a sibling that merely shares a
// string prefix. Without the '/' boundary, '/portal/messages-admin' would
// match the '/portal/messages' nav item (startsWith is true), flipping the
// dropdown to the wrong department and highlighting the wrong link.
function isActiveHref(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/portal') return false;          // dashboard: exact match only
  return pathname.startsWith(href + '/');
}

// Persist sidebar scroll position across page navigations.
const NAV_SCROLL_KEY = 'pushpak:nav-scroll';
// Persist current department selection per session.
const DEPT_KEY = 'pushpak:dept';

export function Sidebar({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const navRef = useRef<HTMLElement | null>(null);

  // All items the current user is allowed to see (role + viewPerms).
  const visibleItems = SECTIONS.flatMap(s => s.items).filter(i => canSee(i, user));

  // Unread chat badge on the "Messages" nav item. Only poll if this user
  // actually has the Messages item (insights-only Vishal does not). Polls
  // every 45s; the count drops on the next poll after they open & read.
  const canSeeMessages = visibleItems.some(i => i.view === 'messages');
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  useEffect(() => {
    if (!canSeeMessages) return;
    let alive = true;
    const load = () => {
      fetch('/api/messages/unread')
        .then(r => r.json())
        .then(r => { if (alive && r?.ok) setUnreadMsgs(r.unread || 0); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 45000);
    return () => { alive = false; clearInterval(t); };
  }, [canSeeMessages, router.pathname]);

  // Which departments are available to this user? Owner always sees
  // all three. Others only see a department if they have at least
  // one visible item in it.
  const availableDepts = (user.role === 'owner')
    ? DEPARTMENTS
    : DEPARTMENTS.filter(d => visibleItems.some(i => i.dept === d.slug));

  // Detect the department of the currently-open page so the dropdown
  // can auto-sync when the user clicks a link in another department.
  const currentItem = visibleItems.find(i => isActiveHref(router.pathname, i.href));

  const [selectedDept, setSelectedDept] = useState<Dept>(() => {
    // Start on the CURRENT page's department from the very first render
    // (router.pathname is SSR-safe, so server + client agree — no
    // hydration mismatch). This matters for scroll restoration below:
    // if we defaulted to availableDepts[0] (e.g. 'command' for the owner,
    // a 1-item list) the saved scroll offset would clamp to 0 against the
    // short list before the department synced to the real, taller one —
    // making the sidebar jump back to the top on every navigation. The
    // effects below still handle the no-current-item case via DEPT_KEY.
    return currentItem?.dept || availableDepts[0]?.slug || 'followup';
  });

  // Initial sync: prefer the current page's department, fall back to
  // the saved sessionStorage value, fall back to the first available.
  useEffect(() => {
    let target: Dept | null = null;
    if (currentItem) target = currentItem.dept;
    if (!target) {
      try {
        const saved = sessionStorage.getItem(DEPT_KEY) as Dept | null;
        if (saved && availableDepts.some(d => d.slug === saved)) target = saved;
      } catch {}
    }
    if (!target) target = availableDepts[0]?.slug || 'followup';
    if (target !== selectedDept) setSelectedDept(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-sync the dropdown to the current page's department on every
  // navigation. So clicking a Settings link from inside Followup
  // flips the dropdown to Settings automatically.
  useEffect(() => {
    if (currentItem && currentItem.dept !== selectedDept) {
      setSelectedDept(currentItem.dept);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem?.dept]);

  // Persist the selected department.
  useEffect(() => {
    try { sessionStorage.setItem(DEPT_KEY, selectedDept); } catch {}
  }, [selectedDept]);

  // Final visible sections: filter by selected department + canSee.
  const sections = SECTIONS
    .map(s => ({ ...s, items: s.items.filter(i => i.dept === selectedDept && canSee(i, user)) }))
    .filter(s => s.items.length > 0);

  // Restore the saved scroll position — but only ONCE, and only after the
  // department (hence the nav's real height) has settled. Depending on
  // selectedDept means that if an effect flips the department after mount,
  // we retry the restore against the correct list height; the ref guard
  // stops it from fighting the user once they start scrolling or switch
  // departments manually.
  const navScrollRestored = useRef(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el || navScrollRestored.current) return;
    try {
      const saved = sessionStorage.getItem(NAV_SCROLL_KEY);
      if (saved != null) {
        el.scrollTop = parseInt(saved, 10) || 0;
        navScrollRestored.current = true;
      }
    } catch {}
  }, [selectedDept]);

  function handleNavScroll() {
    const el = navRef.current;
    if (!el) return;
    try { sessionStorage.setItem(NAV_SCROLL_KEY, String(el.scrollTop)); } catch {}
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img
          src="/pushpak-logo2.png"
          alt="Pushpak"
          style={{ height: 58, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
        />
        <div className="sidebar-brand-text">
          <div className="sidebar-tag" style={{
            letterSpacing: '.26em', fontSize: 9.5, fontWeight: 700,
            color: 'rgba(255,255,255,.78)', lineHeight: 1.3,
          }}>
            DEBTOR<br />CONTROL
          </div>
        </div>
      </div>
      {availableDepts.length > 1 && (
        <div className="sidebar-dept">
          <label className="sidebar-dept-label">Department</label>
          <select
            className="sidebar-dept-select"
            value={selectedDept}
            onChange={e => setSelectedDept(e.target.value as Dept)}
          >
            {availableDepts.map(d => (
              <option key={d.slug} value={d.slug}>{d.label}</option>
            ))}
          </select>
        </div>
      )}
      <nav ref={navRef} className="sidebar-nav scroll" onScroll={handleNavScroll}>
        {sections.map(section => (
          <div key={section.label} className="nav-section">
            <span className="nav-section-label">{section.label}</span>
            {section.items.map(item => {
              const active = isActiveHref(router.pathname, item.href);
              const badge = item.view === 'messages' ? unreadMsgs : 0;
              return (
                <Link key={item.view} href={item.href} className={`nav-link ${active ? 'active' : ''}`}>
                  {item.icon}
                  {item.label}
                  {badge > 0 && (
                    <span style={{
                      marginLeft: 'auto', minWidth: 18, height: 18, padding: '0 5px',
                      borderRadius: 9, background: '#B5483D', color: '#fff',
                      fontSize: 11, fontWeight: 700, display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                    }}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span><span className="dot"></span>System Live</span>
      </div>
    </aside>
  );
}
