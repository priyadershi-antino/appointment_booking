'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, LayoutDashboard } from 'lucide-react';
import { useSession } from '@/components/session';
import { ThemeToggle } from '@/components/theme';

/** Public chrome: light, uncluttered, and out of the way of the booking flow. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const { user, status } = useSession();
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-canvas)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-surface)]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white">
              <CalendarDays size={17} />
            </span>
            <span className="text-[17px] font-extrabold tracking-[-0.02em]">Meridian</span>
          </Link>

          <nav className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              href="/"
              className={pathname === '/' ? 'nav-item-active px-3' : 'btn-ghost'}
              aria-current={pathname === '/' ? 'page' : undefined}
            >
              Book
            </Link>

            {status === 'authenticated' ? (
              <Link href="/dashboard" className="btn-secondary btn-sm ml-1">
                <LayoutDashboard size={14} />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            ) : status === 'anonymous' ? (
              <Link href="/login" className="btn-secondary btn-sm ml-1">
                Staff sign in
              </Link>
            ) : (
              <div className="skeleton ml-1 h-8 w-24" />
            )}

            {user ? (
              <span
                className="ml-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-bold text-[var(--color-accent)]"
                title={user.name}
              >
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            ) : null}
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm font-bold">Meridian Clinic</p>
            <p className="text-xs text-[var(--color-ink-subtle)] max-w-md">
              Times are shown in your own timezone. Availability is calculated by the booking
              engine on the server, never in the browser.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
