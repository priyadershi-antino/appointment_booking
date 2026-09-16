import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma.js';
import { localToUtc, toDateKey, weekdayOf, addDaysToDateKey, type DateKey } from '../../src/domain/time/zone.js';

/**
 * Fixture builders.
 *
 * Every fixture is uniquely named. Test files share one database and run in separate
 * processes, so anything with a fixed email or slug would collide the moment two files
 * ran at once — and the failure would look like a bug in whichever happened to lose.
 * Uniqueness here is what lets the suite stay parallel.
 */

export const TEST_PASSWORD = 'Test@12345';
export const IST = 'Asia/Kolkata';

let counter = 0;
const unique = (): string => `${Date.now().toString(36)}${(counter += 1).toString(36)}${randomUUID().slice(0, 8)}`;

export const uniqueEmail = (prefix = 'user'): string => `${prefix}-${unique()}@test.local`;

/** Hashing at the real cost factor 12 makes every fixture slow; tests do not need it. */
const fastHash = (plain: string): Promise<string> => bcrypt.hash(plain, 4);

/* ── Time ─────────────────────────────────────────────────────────────────── */

export const H = (hours: number, minutes = 0): number => hours * 60 + minutes;

/**
 * The next calendar date that falls on `weekday`, at least `minDaysAhead` days out.
 *
 * Tests must never book "tomorrow at 09:00" — that time may already have passed, or fall
 * inside the service's minimum-notice window, and the test would fail on some runs and
 * pass on others depending on the hour it was executed.
 */
export function upcomingDateKey(weekday: number, timeZone = IST, minDaysAhead = 3): DateKey {
  let key = addDaysToDateKey(toDateKey(new Date(), timeZone), minDaysAhead);
  for (let i = 0; i < 7; i += 1) {
    if (weekdayOf(key) === weekday) return key;
    key = addDaysToDateKey(key, 1);
  }
  return key;
}

/** A real UTC instant for a wall-clock time on a given local date. */
export function instantAt(dateKey: DateKey, minuteOfDay: number, timeZone = IST): Date {
  return localToUtc(dateKey, minuteOfDay, timeZone).instant;
}

/* ── People ───────────────────────────────────────────────────────────────── */

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

export async function createAdmin(overrides: { name?: string } = {}): Promise<TestUser> {
  const email = uniqueEmail('admin');
  const name = overrides.name ?? 'Test Admin';
  const user = await prisma.user.create({
    data: { name, email, passwordHash: await fastHash(TEST_PASSWORD), role: 'ADMIN', timezone: IST },
  });
  return { id: user.id, email, password: TEST_PASSWORD, name };
}

export interface TestProvider extends TestUser {
  /** The Provider profile id — distinct from the User id, and the one routes take. */
  providerId: string;
  timezone: string;
}

/**
 * Creates the sign-in account and the calendar profile together, mirroring what the admin
 * onboarding route does, so a provider fixture is never in the half-created state where a
 * profile exists that nobody can sign in to.
 */
export async function createProvider(
  options: {
    name?: string;
    timezone?: string;
    /** Defaults to Monday–Friday, 09:00–17:00. */
    weeklyRules?: { weekday: number; startMinute: number; endMinute: number }[];
  } = {},
): Promise<TestProvider> {
  const email = uniqueEmail('provider');
  const name = options.name ?? 'Dr Test Provider';
  const timezone = options.timezone ?? IST;

  const rules = options.weeklyRules ?? [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: H(9),
    endMinute: H(17),
  }));

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await fastHash(TEST_PASSWORD),
      role: 'PROVIDER',
      timezone,
      provider: { create: { slug: `provider-${unique()}`, timezone } },
    },
    include: { provider: true },
  });

  const providerId = user.provider!.id;
  if (rules.length > 0) {
    await prisma.availabilityRule.createMany({
      data: rules.map((rule) => ({ providerId, ...rule })),
    });
  }

  return { id: user.id, email, password: TEST_PASSWORD, name, providerId, timezone };
}

export interface TestCustomer extends TestUser {
  customerId: string;
}

export async function createCustomerUser(options: { name?: string } = {}): Promise<TestCustomer> {
  const email = uniqueEmail('customer');
  const name = options.name ?? 'Test Customer';
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await fastHash(TEST_PASSWORD),
      role: 'CUSTOMER',
      timezone: IST,
      customer: { create: { name, email, timezone: IST } },
    },
    include: { customer: true },
  });
  return { id: user.id, email, password: TEST_PASSWORD, name, customerId: user.customer!.id };
}

/* ── Catalog ──────────────────────────────────────────────────────────────── */

export interface ServiceOptions {
  name?: string;
  durationMin?: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  slotIntervalMin?: number;
  minNoticeMin?: number;
  maxAdvanceDays?: number;
  maxPerDay?: number | null;
  maxPerCustomerPerDay?: number | null;
  priceMinor?: number;
  isActive?: boolean;
  paymentMode?: 'FREE' | 'PAY_AT_BOOKING' | 'PAY_LATER';
  providerIds?: string[];
  cancellationPolicyId?: string | null;
}

/**
 * Note the per-customer cap defaults to 20 here, not the schema's 1. Most tests book
 * several appointments on one day and are not testing that cap; leaving it at 1 would
 * make them fail for a reason unrelated to what they assert.
 */
export async function createService(options: ServiceOptions = {}) {
  return prisma.service.create({
    data: {
      name: options.name ?? 'Test Consultation',
      slug: `service-${unique()}`,
      durationMin: options.durationMin ?? 30,
      bufferBeforeMin: options.bufferBeforeMin ?? 0,
      bufferAfterMin: options.bufferAfterMin ?? 0,
      slotIntervalMin: options.slotIntervalMin ?? 15,
      minNoticeMin: options.minNoticeMin ?? 120,
      maxAdvanceDays: options.maxAdvanceDays ?? 60,
      maxPerDay: options.maxPerDay === undefined ? null : options.maxPerDay,
      // The column is non-nullable, so there is no "unlimited" to express — null from a
      // caller is treated the same as omitting it.
      maxPerCustomerPerDay: options.maxPerCustomerPerDay ?? 20,
      priceMinor: options.priceMinor ?? 80_000,
      currency: 'INR',
      paymentMode: options.paymentMode ?? 'FREE',
      isActive: options.isActive ?? true,
      cancellationPolicyId: options.cancellationPolicyId ?? null,
      providers: {
        create: (options.providerIds ?? []).map((providerId) => ({ providerId })),
      },
    },
  });
}

export async function createCancellationPolicy(
  options: {
    allowCancellation?: boolean;
    cancellationDeadlineMin?: number;
    allowReschedule?: boolean;
    rescheduleDeadlineMin?: number;
    maxReschedules?: number;
  } = {},
) {
  return prisma.cancellationPolicy.create({
    data: {
      name: `Policy ${unique()}`,
      description: 'Test policy',
      allowCancellation: options.allowCancellation ?? true,
      cancellationDeadlineMin: options.cancellationDeadlineMin ?? 1440,
      allowReschedule: options.allowReschedule ?? true,
      rescheduleDeadlineMin: options.rescheduleDeadlineMin ?? 120,
      maxReschedules: options.maxReschedules ?? 3,
    },
  });
}

/* ── A whole working world ────────────────────────────────────────────────── */

export interface World {
  admin: TestUser;
  provider: TestProvider;
  service: Awaited<ReturnType<typeof createService>>;
  /** A Monday comfortably in the future, in the provider's zone. */
  monday: DateKey;
}

/**
 * The arrangement most tests need: one admin, one provider working weekdays 09:00–17:00,
 * and one service they offer. Built in one call so individual tests open with their own
 * specifics rather than fifteen lines of identical scaffolding.
 */
export async function buildWorld(service: ServiceOptions = {}): Promise<World> {
  const [admin, provider] = await Promise.all([createAdmin(), createProvider()]);
  const created = await createService({ ...service, providerIds: [provider.providerId] });
  return { admin, provider, service: created, monday: upcomingDateKey(1, provider.timezone) };
}
