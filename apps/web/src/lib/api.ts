/**
 * Where the API lives — and it is deliberately not the same answer on both sides.
 *
 * In the browser this is a relative path, so requests go to the web app's own origin and
 * are proxied on to the API from there (see `next.config.ts`). That keeps the session
 * cookie first-party: browsers now block cross-site cookies by default, so a split
 * api/web domain would let login succeed and then drop the cookie on every request after
 * it. Being same-origin also removes CORS from the picture entirely.
 *
 * On the server there is no origin for a relative path to resolve against, so server
 * components need an absolute URL that reaches the API directly.
 */
const BROWSER_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
const SERVER_BASE = process.env.INTERNAL_API_URL ?? 'http://localhost:4000/api/v1';

export const apiBase = (): string =>
  typeof window === 'undefined' ? SERVER_BASE : BROWSER_BASE;

export interface ApiError {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
  requestId?: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Single entry point to the API.
 *
 * Unwraps the success envelope and turns a failure envelope into a typed error, so every
 * component deals with data or an ApiRequestError and never with raw shapes. Credentials
 * are always included because auth lives in httpOnly cookies.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
    ...init,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new ApiRequestError(
      response.status,
      body?.error ?? { code: 'NETWORK_ERROR', message: 'Could not reach the server.' },
    );
  }

  return body.data as T;
}

export const formatMoney = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );

export const browserTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

export const formatTime = (iso: string, timezone: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

export const formatDateLong = (iso: string, timezone: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  durationMin: number;
  priceMinor: number;
  currency: string;
  locationType: string;
  locationDetail: string | null;
  color: string | null;
  minNoticeMin: number;
  maxAdvanceDays: number;
  cancellationPolicy: { description: string } | null;
  providers: { id: string; name: string; title: string | null; timezone: string }[];
}

export interface Slot {
  startUtc: string;
  endUtc: string;
  providerId: string;
  providerName: string;
}

export interface SlotsResponse {
  serviceId: string;
  serviceName: string;
  durationMin: number;
  displayTimezone: string;
  providerTimezone: string;
  days: { date: string; slots: Slot[] }[];
}

export interface Appointment {
  id: string;
  code: string;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  serviceName: string;
  providerName: string;
  durationMin: number;
  priceMinor: number;
  currency: string;
  locationType: string;
  locationDetail: string | null;
  notes: string | null;
}
