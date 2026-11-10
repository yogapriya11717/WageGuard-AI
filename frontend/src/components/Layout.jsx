import { NavLink, Link, Outlet } from 'react-router-dom'
import { useState, useEffect } from "react";
import { Icon } from './ui.jsx'
import { useStore } from '../store.jsx'

const nav = [
  { to: '/', label: 'Desk', icon: 'home', end: true },
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { to: '/scope', label: 'Scope requests', icon: 'scope' },
  { to: '/payments', label: 'Payments', icon: 'wallet' },
]

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2l11 4v9c0 7-4.6 12.2-11 15C9.6 27.2 5 22 5 15V6z" fill="var(--ink)" />
      <path d="M11 16l3.5 3.5L21.5 12" fill="none" stroke="var(--paper)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Layout() {
    const [theme, setTheme] = useState(() => {
    return localStorage.getItem("wageguard-theme") || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("wageguard-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => current === "light" ? "dark" : "light");
  };
  const { projects, loading, error, reload } = useStore()
  const pending = projects.flatMap((p) => p.scopeChanges).filter((s) => s.status === 'pending').length
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="brand">
          <Mark />
          <span>Wage<em>Guard</em></span>
        </Link>

        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.to === '/scope' && pending > 0 && <b className="count">{pending}</b>}
            </NavLink>
          ))}
        </nav>

        <p className="side-note">
          WageGuard helps you track and clarify. It is not escrow and it can’t enforce a contract.
        </p>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="today">{today}</span>
          <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
            <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
          </button>
        </header>
        <main className="page">
          {loading ? (
            <div className="empty" role="status">
              <h3>Loading your projects…</h3>
              <p>Fetching them from the WageGuard server.</p>
            </div>
          ) : error ? (
            <div className="empty" role="alert">
              <h3>Couldn’t load your projects</h3>
              <p>{error}</p>
              <button type="button" className="btn btn-primary" onClick={reload}>Try again</button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  )
}
