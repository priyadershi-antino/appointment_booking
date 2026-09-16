'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from '@/lib/api';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'PROVIDER' | 'CUSTOMER';
  timezone: string;
  permissions: string[];
  providerId: string | null;
  customerId: string | null;
}

interface SessionState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionState>({
  user: null,
  status: 'loading',
  refresh: async () => {},
  signOut: async () => {},
  can: () => false,
});

export const useSession = () => useContext(SessionContext);

/**
 * Client-side session.
 *
 * The session itself is an httpOnly cookie the browser holds and JavaScript cannot read,
 * so this asks the API who it is rather than decoding anything locally. What lives here
 * is only a cache of that answer, used to decide what to render — every actual permission
 * check happens on the server, so a tampered cache buys nothing.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionState['status']>('loading');

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: SessionUser }>('/auth/me');
      setUser(data.user);
      setStatus('authenticated');
    } catch (error) {
      // An expired access token is recoverable: rotate it once, then retry.
      if (error instanceof ApiRequestError && error.error.code === 'TOKEN_EXPIRED') {
        try {
          await api('/auth/refresh', { method: 'POST' });
          const data = await api<{ user: SessionUser }>('/auth/me');
          setUser(data.user);
          setStatus('authenticated');
          return;
        } catch {
          // Fall through to anonymous.
        }
      }
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  return (
    <SessionContext.Provider value={{ user, status, refresh, signOut, can }}>
      {children}
    </SessionContext.Provider>
  );
}
