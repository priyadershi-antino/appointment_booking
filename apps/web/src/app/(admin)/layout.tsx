'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  Stethoscope,
  X,
} from 'lucide-react';
import { useSession } from '@/components/session';
import { EmptyState } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/calendar', label: 'Calendar', icon: CalendarRange },
  { href: '/appointments', label: 'Appointments', icon: ClipboardList },
  { href: '/availability', label: 'Availability', icon: Clock },
  { href: '/services', label: 'Services', icon: Stethoscope },
];

/**
 * Admin console shell.
 *
 * A persistent sidebar on desktop, a slide-over on mobile. The nav renders only after the
 * session resolves, so a signed-out visitor never sees a console frame briefly flash
 * before being told to sign in.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, status, signOut } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)]">
        <div className="skeleton h-9 w-40" />
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4">
        <div className="card w-full max-w-md">
          <EmptyState
            icon={<CalendarDays size={20} />}
            title="Sign in to continue"
            description="The console shows appointments, availability and analytics for your account."
            action={
              <Link href="/login" className="btn-primary">
                Sign in
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const sidebar = (
    <>
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white">
          <CalendarDays size={17} />
        </span>
        <span className="text-[17px] font-extrabold tracking-[-0.02em]">Meridian</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={active ? 'nav-item-active' : 'nav-item'}
            >
              <Icon size={16} className="shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--color-line)] p-3">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-bold text-[var(--color-accent)]">
            {user?.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs capitalize text-[var(--color-ink-subtle)]">
              {user?.role.toLowerCase()}
            </p>
          </div>
        </div>
        <button type="button" className="nav-item w-full mt-1" onClick={() => void signOut()}>
          <LogOut size={16} />
          Sign out
        </button>
        <Link href="/" className="nav-item w-full">
          <CalendarDays size={16} />
          Booking page
        </Link>
        <div className="mt-2 px-2">
          <ThemeToggle />
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] lg:flex">
        {sidebar}
      </aside>

      {/* Mobile slide-over */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-[var(--color-ink)]/45"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <aside className="animate-slide-in absolute inset-y-0 left-0 flex w-64 flex-col bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
            <button
              type="button"
              aria-label="Close menu"
              className="btn-ghost absolute right-2 top-4 h-8 w-8 p-0"
              onClick={() => setMenuOpen(false)}
            >
              <X size={16} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)]/85 px-4 backdrop-blur-md lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            className="btn-ghost h-9 w-9 p-0"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={18} />
          </button>
          <span className="font-extrabold tracking-[-0.02em]">Meridian</span>
        </header>

        <main id="main" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
