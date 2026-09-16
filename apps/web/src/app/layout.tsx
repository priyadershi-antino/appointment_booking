import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meridian Clinic — Appointments',
  description: 'Book, reschedule and manage appointments.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-[var(--color-line)]">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-black tracking-tight text-lg">
              Meridian<span className="text-[var(--color-accent)]">.</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="btn-ghost">
                Book
              </Link>
              <Link href="/dashboard" className="btn-ghost">
                Dashboard
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--color-line-soft)] py-6 mt-12">
          <p className="mx-auto max-w-6xl px-4 text-xs text-[var(--color-ink-subtle)]">
            Times are shown in your local timezone. Availability is calculated by the booking
            engine, never in the browser.
          </p>
        </footer>
      </body>
    </html>
  );
}
