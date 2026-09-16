'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { ErrorState } from '@/components/ui';

/**
 * Sign-in. A client component by necessity: the session lives in httpOnly cookies the
 * API sets, so the request has to originate from the browser for the cookie to be stored.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('Demo@12345');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.push('/dashboard');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.error.message : 'Could not sign you in.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-3xl font-black tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Staff access to the dashboard. Customers do not need an account to book.
      </p>

      {error ? (
        <div className="mt-6">
          <ErrorState message={error} />
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="field"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="field"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-8 border-t border-[var(--color-line-soft)] pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Demo accounts
        </p>
        <ul className="mt-2 space-y-1 text-sm text-[var(--color-ink-muted)]">
          <li>
            <button
              type="button"
              className="underline hover:text-[var(--color-ink)]"
              onClick={() => setEmail('admin@example.com')}
            >
              admin@example.com
            </button>{' '}
            — full access
          </li>
          <li>
            <button
              type="button"
              className="underline hover:text-[var(--color-ink)]"
              onClick={() => setEmail('provider@example.com')}
            >
              provider@example.com
            </button>{' '}
            — own calendar only
          </li>
        </ul>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Password: <span className="font-bold">Demo@12345</span>
        </p>
      </div>
    </div>
  );
}
