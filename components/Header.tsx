// ============================================================
// Header — title + crumb + clock + avatar + logout.
// Title and crumb are passed in by each page.
// ============================================================
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import type { CurrentUser } from './Sidebar';

const fmtTime = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
});

export function Header({ user, title, crumb }: { user: CurrentUser; title: string; crumb?: string }) {
  const router = useRouter();
  const [now, setNow] = useState('');

  useEffect(() => {
    const tick = () => setNow(fmtTime.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.replace('/login');
  }

  const initial = (user.name || '?')[0].toUpperCase();

  return (
    <header className="header">
      <div className="header-title">
        <h1>{title}</h1>
        {crumb && <span className="crumb">{crumb}</span>}
      </div>
      <div className="header-actions">
        <span className="header-clock">{now}<span className="ist">IST</span></span>
        <div className="user-block">
          <div className="user-avatar">{initial}</div>
          <div>
            <div className="user-name">{user.name}</div>
            <div className="user-role">{user.badge}</div>
          </div>
        </div>
        <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">
          <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
        </button>
      </div>
    </header>
  );
}
