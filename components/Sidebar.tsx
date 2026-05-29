// ============================================================
// Sidebar — role-aware nav, per-ID overrides (Vishal minimal,
// Vanshika no My Worklist), collapses empty section labels.
// ============================================================
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, type ReactNode } from 'react';

export type CurrentUser = {
  id: string;
  execId: string;
  name: string;
  role: string;
  badge: string;
  viewPerms?: string[] | null;
};

type NavItem = { view: string; label: string; roles: string[]; href: string; icon: ReactNode };
type NavSection = { label: string; items: NavItem[]; roles: string[] };

const SECTIONS: NavSection[] = [
  {
    label: 'Operations',
    roles: ['owner', 'admin', 'cm', 'exec'],
    items: [
      { view: 'dashboard',     label: 'Dashboard',      href: '/portal',               roles: ['owner','admin','cm','exec','analyst'], icon: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> },
      { view: 'worklist',      label: 'My Worklist',    href: '/portal/worklist',      roles: ['owner','admin','cm','exec'], icon: <svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
      { view: 'team-worklist', label: 'Team Worklist',  href: '/portal/team-worklist', roles: ['owner','admin','cm'], icon: <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { view: 'hold-check',    label: 'Hold Check',     href: '/portal/hold-check',    roles: ['owner','admin','cm','exec'], icon: <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> },
    ],
  },
  {
    label: 'Ledgers',
    roles: ['owner', 'admin', 'cm', 'exec', 'analyst'],
    items: [
      { view: 'families',      label: 'Clients & Families', href: '/portal/families',     roles: ['owner','admin'], icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M15 14h2a4 4 0 0 1 4 4v3"/></svg> },
      { view: 'promises',      label: 'Promise Ledger',     href: '/portal/promises',     roles: ['owner','admin','cm','exec'], icon: <svg viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 14l2 2 4-4"/></svg> },
      { view: 'payment-plans', label: 'Doubtful Ledger',    href: '/portal/payment-plans', roles: ['owner','admin','cm','exec'], icon: <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg> },
      { view: 'legal',         label: 'Legal Ledger',       href: '/portal/legal',        roles: ['owner','admin','cm','exec','analyst'], icon: <svg viewBox="0 0 24 24"><path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7l8-4z"/></svg> },
      { view: 'collections',   label: 'Collection List',    href: '/portal/collections',  roles: ['owner','admin','cm','exec','analyst'], icon: <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h12"/><circle cx="19" cy="18" r="2.5"/></svg> },
    ],
  },
  {
    label: 'Insights',
    roles: ['owner', 'admin', 'cm', 'exec', 'analyst'],
    items: [
      { view: 'performance', label: 'Performance', href: '/portal/performance', roles: ['owner','admin','cm','exec'], icon: <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> },
      { view: 'scoreboard',  label: 'Scoreboard',  href: '/portal/scoreboard',  roles: ['owner','admin','cm'], icon: <svg viewBox="0 0 24 24"><path d="M6 9h12M6 15h12M4 5l16 0v14H4z"/></svg> },
      { view: 'insights',    label: 'Insights',    href: '/portal/insights',    roles: ['owner','analyst'], icon: <svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/></svg> },
    ],
  },
  {
    label: 'People',
    roles: ['owner', 'admin'],
    items: [
      { view: 'attendance', label: 'Attendance', href: '/portal/attendance', roles: ['owner','admin'], icon: <svg viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 16l2 2 4-4"/></svg> },
      { view: 'employees',  label: 'Employees',  href: '/portal/employees',  roles: ['owner','admin'], icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87"/></svg> },
    ],
  },
  {
    label: 'Administration',
    roles: ['owner', 'admin'],
    items: [
      { view: 'users-auth', label: 'Users & Authorities', href: '/portal/users-auth', roles: ['owner'], icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M3 21c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9.5" r="2.5"/></svg> },
      { view: 'audit',      label: 'Audit Log',           href: '/portal/audit',      roles: ['owner'], icon: <svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg> },
      { view: 'permissions',label: 'Permissions',         href: '/portal/permissions',roles: ['owner'], icon: <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg> },
      { view: 'activity',   label: 'Activity & Time',     href: '/portal/activity',   roles: ['owner','admin'], icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> },
      { view: 'bulk-cm',    label: 'Bulk CM Assignment',  href: '/portal/bulk-cm',    roles: ['owner','admin'], icon: <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
      { view: 'settings',   label: 'Settings',            href: '/portal/settings',   roles: ['owner','admin'], icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/></svg> },
    ],
  },
  {
    label: 'Data',
    roles: ['owner', 'admin'],
    items: [
      { view: 'upload', label: 'Upload & Refresh', href: '/portal/upload', roles: ['owner','admin'], icon: <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg> },
    ],
  },
];

// Per-ID overrides on top of the role-based defaults.
const VISHAL_ALLOWED_VIEWS = new Set(['insights', 'collections']);
const VANSHIKA_HIDDEN_VIEWS = new Set(['worklist']);

function canSee(item: NavItem, user: CurrentUser): boolean {
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
  if (!item.roles.includes(user.role)) return false;
  if (user.execId === 'VISHAL01')   return VISHAL_ALLOWED_VIEWS.has(item.view);
  if (user.execId === 'VANSHIKA01') return !VANSHIKA_HIDDEN_VIEWS.has(item.view);
  return true;
}

// Persist sidebar scroll position across page navigations. Without
// this the .sidebar-nav scrolls back to the top every time the user
// clicks a link, which is annoying when the link they're aiming at
// lives near the bottom (Audit Log / Permissions / Settings).
// We use sessionStorage so the scroll survives in-tab navigation but
// resets cleanly on a fresh login.
const NAV_SCROLL_KEY = 'pushpak:nav-scroll';

export function Sidebar({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const navRef = useRef<HTMLElement | null>(null);
  const sections = SECTIONS
    .map(s => ({ ...s, items: s.items.filter(i => canSee(i, user)) }))
    .filter(s => s.items.length > 0);

  // Restore the saved scroll position on mount. Synchronous via
  // useLayoutEffect-equivalent timing isn't needed — the browser
  // hasn't painted yet on first effect tick, so the user never sees
  // the brief 0-scroll flash.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    try {
      const saved = sessionStorage.getItem(NAV_SCROLL_KEY);
      if (saved) el.scrollTop = parseInt(saved, 10) || 0;
    } catch { /* sessionStorage disabled — no-op */ }
  }, []);

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
      <nav ref={navRef} className="sidebar-nav scroll" onScroll={handleNavScroll}>
        {sections.map(section => (
          <div key={section.label} className="nav-section">
            <span className="nav-section-label">{section.label}</span>
            {section.items.map(item => {
              const active = router.pathname === item.href ||
                            (item.href !== '/portal' && router.pathname.startsWith(item.href));
              return (
                <Link key={item.view} href={item.href} className={`nav-link ${active ? 'active' : ''}`}>
                  {item.icon}
                  {item.label}
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
