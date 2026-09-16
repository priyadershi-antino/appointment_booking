import request from 'supertest';
import type { Test } from 'supertest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

export const app = createApp();
export const API = env.API_PREFIX;

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

let ipCounter = 0;
/** Test files run in separate processes with their own counters, so keep them apart. */
const processBlock = 1 + Math.floor(Math.random() * 250);

/**
 * A distinct client address per caller.
 *
 * The app trusts one proxy hop, so `X-Forwarded-For` becomes `req.ip` and therefore the
 * rate-limiter key. Handing each client its own address gives it its own budget — without
 * it, the thirteenth booking in a file would return 429 and the failure would appear to be
 * in whichever test ran last rather than in the one that exhausted the quota.
 *
 * Tests that want to exercise the limiter pin an address deliberately instead.
 */
export const nextClientIp = (): string => {
  ipCounter += 1;
  return `10.${processBlock}.${Math.floor(ipCounter / 254) % 254}.${(ipCounter % 253) + 1}`;
};

/**
 * A caller with an identity and an address.
 *
 * Authentication travels the way the browser sends it — the httpOnly cookies the login
 * route actually sets — rather than a token minted in the test. A test that signs its own
 * tokens stops proving that signing in works.
 */
export class ApiClient {
  private cookies: string[] = [];

  constructor(
    readonly ip: string = nextClientIp(),
    readonly user?: { id: string; email: string },
  ) {}

  private send(method: Method, path: string): Test {
    const req = request(app)[method](path.startsWith('/api') ? path : `${API}${path}`)
      .set('X-Forwarded-For', this.ip)
      .set('User-Agent', 'booking-tests');
    if (this.cookies.length > 0) req.set('Cookie', this.cookies);
    return req;
  }

  get = (path: string): Test => this.send('get', path);
  post = (path: string): Test => this.send('post', path);
  put = (path: string): Test => this.send('put', path);
  patch = (path: string): Test => this.send('patch', path);
  delete = (path: string): Test => this.send('delete', path);

  /** Replace the cookie jar from a response's `Set-Cookie`. */
  absorb(response: { headers: Record<string, unknown> }): this {
    const raw = response.headers['set-cookie'];
    if (Array.isArray(raw)) this.cookies = raw.map((cookie) => cookie.split(';')[0] ?? '');
    return this;
  }

  /** The current value of one cookie, or undefined when it is absent or cleared. */
  cookie(name: string): string | undefined {
    const match = this.cookies.find((entry) => entry.startsWith(`${name}=`));
    const value = match?.slice(name.length + 1);
    return value ? value : undefined;
  }

  get rawCookies(): string[] {
    return [...this.cookies];
  }

  /** Overwrite the jar, so a test can present a specific (for example, stale) token. */
  setCookie(name: string, value: string): this {
    this.cookies = [...this.cookies.filter((c) => !c.startsWith(`${name}=`)), `${name}=${value}`];
    return this;
  }
}

/** An unauthenticated caller — a guest, or an attacker. */
export const anonymous = (ip?: string): ApiClient => new ApiClient(ip);

/**
 * Signs in for real and keeps the resulting session cookies.
 *
 * Throws on failure rather than returning a broken client, because a fixture that quietly
 * fails to authenticate produces a 401 three assertions later in a test about something
 * else entirely.
 */
export async function signIn(
  credentials: { email: string; password: string },
  ip?: string,
): Promise<ApiClient> {
  const client = new ApiClient(ip);
  const response = await client
    .post('/auth/login')
    .send({ email: credentials.email, password: credentials.password });

  if (response.status !== 200) {
    throw new Error(
      `Test fixture could not sign in as ${credentials.email}: ` +
        `${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return client.absorb(response);
}

/* ── Envelope assertions ──────────────────────────────────────────────────── */

interface Envelope {
  status: number;
  body: { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };
}

/** Asserts a successful envelope and returns `data`, typed. */
export function dataOf<T>(response: Envelope, expectedStatus = 200): T {
  if (response.status !== expectedStatus || response.body.success !== true) {
    throw new Error(
      `Expected ${expectedStatus} success, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return response.body.data as T;
}

/** The machine-readable error code, or a readable failure if the response was a success. */
export function errorCodeOf(response: Envelope): string {
  if (response.body.success !== false) {
    throw new Error(`Expected a failure envelope, got ${JSON.stringify(response.body)}`);
  }
  return response.body.error?.code ?? '(no code)';
}
