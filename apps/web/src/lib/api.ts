const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

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
  const response = await fetch(`${BASE}${path}`, {
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
