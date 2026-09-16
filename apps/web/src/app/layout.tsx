import type { Metadata, Viewport } from 'next';
import { SessionProvider } from '@/components/session';
import { ThemeProvider, themeScript } from '@/components/theme';
import { ToastProvider } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Meridian Clinic — Appointments',
    template: '%s · Meridian Clinic',
  },
  description:
    'Book, reschedule and manage appointments with Meridian Clinic. Real-time availability, instant confirmation.',
};

export const viewport: Viewport = {
  themeColor: '#4f2fe0',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout carries only the document shell and the two providers everything needs.
 * The visible chrome differs sharply between the public booking flow and the admin
 * console, so each route group brings its own layout rather than sharing one here.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before first paint so dark-mode users never see a white flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-[var(--radius-sm)] focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-[var(--shadow-lg)]"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <SessionProvider>
            <ToastProvider>{children}</ToastProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
