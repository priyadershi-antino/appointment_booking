import { ErrorCode, type AvailableDatesDto, type SlotQueryResultDto } from '@booking/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { interval, type Interval } from '../../domain/time/interval.js';
import {
  addDaysToDateKey,
  enumerateDateKeys,
  toDateKey,
  type DateKey,
} from '../../domain/time/zone.js';
import {
  generateSlots,
  groupSlotsByDate,
  type GeneratedSlot,
  type ProviderSchedule,
  type ServiceRules,
  type SlotRequest,
} from '../../domain/scheduling/slot-engine.js';

/**
 * Statuses whose appointment still reserves its buffered interval.
 *
 * This list is duplicated in the PostgreSQL exclusion-constraint predicate. The two MUST
 * agree: if the engine used a narrower list it would offer slots the database then
 * rejects (a 409 on a slot shown as free), and a wider one would hide bookable time
 * permanently and invisibly.
 */
export const OCCUPYING_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const;

export interface SlotQueryInput {
  serviceId: string;
  providerId?: string | null;
  from: DateKey;
  to: DateKey;
  timezone: string;
  now: Date;
  /** Applies the per-customer daily cap when the requester is known. */
  customerId?: string | null;
}

/**
 * Loads everything the engine needs in a small fixed number of queries, then hands it
 * plain data. Deliberately no per-provider or per-date round trips: the query count does
 * not grow with the size of the range being displayed.
 */
async function loadContext(input: SlotQueryInput) {
  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, deletedAt: null },
    include: {
      providers: {
        include: {
          provider: {
            include: { user: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!service) throw new AppError(ErrorCode.SERVICE_NOT_FOUND);
  if (!service.isActive) throw new AppError(ErrorCode.SERVICE_INACTIVE);

  const assignments = service.providers.filter(
    (link) => link.provider.isActive && link.provider.deletedAt === null,
  );

  const selected = input.providerId
    ? assignments.filter((link) => link.providerId === input.providerId)
    : assignments;

  if (input.providerId && selected.length === 0) {
    // Either the provider does not exist, or they do not offer this service. Both are
    // business-rule failures rather than 404s from the customer's point of view.
    const exists = await prisma.provider.findUnique({ where: { id: input.providerId } });
    throw new AppError(exists ? ErrorCode.PROVIDER_NOT_ASSIGNED : ErrorCode.PROVIDER_NOT_FOUND);
  }
  if (selected.length === 0) throw new AppError(ErrorCode.NO_PROVIDER_AVAILABLE);

  const providerIds = selected.map((link) => link.providerId);

  // Pad the window by a day either side so appointments and time off that straddle a
  // local midnight are still seen by the engine.
  const rangeStart = new Date(`${addDaysToDateKey(input.from, -1)}T00:00:00Z`);
  const rangeEnd = new Date(`${addDaysToDateKey(input.to, 2)}T00:00:00Z`);

  const [rules, overrides, timeOff, appointments, holidays, settings] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { providerId: { in: providerIds } } }),
    prisma.availabilityOverride.findMany({
      where: { providerId: { in: providerIds }, date: { gte: rangeStart, lte: rangeEnd } },
      include: { windows: true },
    }),
    prisma.timeOff.findMany({
      where: {
        providerId: { in: providerIds },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      },
    }),
    prisma.appointment.findMany({
      where: {
        providerId: { in: providerIds },
        status: { in: [...OCCUPYING_STATUSES] },
        blockStartsAt: { lt: rangeEnd },
        blockEndsAt: { gt: rangeStart },
      },
      select: {
        providerId: true,
        blockStartsAt: true,
        blockEndsAt: true,
        startsAt: true,
        customerId: true,
      },
    }),
    prisma.holiday.findMany({ where: { date: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.businessSettings.findFirst(),
  ]);

  const businessTimeZone = settings?.timezone ?? 'Asia/Kolkata';

  const schedules: ProviderSchedule[] = selected.map((link) => {
    const providerId = link.providerId;
    const providerTz = link.provider.timezone;

    const providerOverrides = new Map<DateKey, ProviderSchedule['overrides'] extends Map<DateKey, infer V> ? V : never>();
    for (const override of overrides.filter((o) => o.providerId === providerId)) {
      const key = override.date.toISOString().slice(0, 10);
      providerOverrides.set(key, {
        dateKey: key,
        type: override.type,
        windows: override.windows.map((w) => ({
          startMinute: w.startMinute,
          endMinute: w.endMinute,
        })),
      });
    }

    const busy: Interval[] = [];
    const bookingsByDate = new Map<DateKey, number>();
    for (const appointment of appointments) {
      if (appointment.providerId !== providerId) continue;
      busy.push(interval(appointment.blockStartsAt.getTime(), appointment.blockEndsAt.getTime()));
      const key = toDateKey(appointment.startsAt, providerTz);
      bookingsByDate.set(key, (bookingsByDate.get(key) ?? 0) + 1);
    }

    return {
      providerId,
      providerName: link.provider.user.name,
      timeZone: providerTz,
      weeklyRules: rules
        .filter((rule) => rule.providerId === providerId)
        .map((rule) => ({
          weekday: rule.weekday,
          startMinute: rule.startMinute,
          endMinute: rule.endMinute,
        })),
      overrides: providerOverrides,
      timeOff: timeOff
        .filter((entry) => entry.providerId === providerId)
        .map((entry) => interval(entry.startsAt.getTime(), entry.endsAt.getTime())),
      busy,
      bookingsByDate,
    };
  });

  const customerBookingsByDate = new Map<DateKey, number>();
  if (input.customerId) {
    for (const appointment of appointments) {
      if (appointment.customerId !== input.customerId) continue;
      const key = toDateKey(appointment.startsAt, businessTimeZone);
      customerBookingsByDate.set(key, (customerBookingsByDate.get(key) ?? 0) + 1);
    }
  }

  const serviceRules: ServiceRules = {
    durationMin: service.durationMin,
    bufferBeforeMin: service.bufferBeforeMin,
    bufferAfterMin: service.bufferAfterMin,
    slotIntervalMin: service.slotIntervalMin,
    minNoticeMin: service.minNoticeMin,
    maxAdvanceDays: service.maxAdvanceDays,
    maxPerDay: service.maxPerDay,
    maxPerCustomerPerDay: service.maxPerCustomerPerDay,
  };

  const request: SlotRequest = {
    service: serviceRules,
    providers: schedules,
    holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
    businessTimeZone,
    dateKeys: enumerateDateKeys(input.from, input.to),
    now: input.now,
    customerBookingsByDate,
  };

  return { service, request, businessTimeZone };
}

export async function findSlots(input: SlotQueryInput): Promise<SlotQueryResultDto> {
  const { service, request } = await loadContext(input);
  const slots = generateSlots(request);
  const grouped = groupSlotsByDate(slots, input.timezone);

  // Every requested date appears, empty ones included, so the UI can render "no times"
  // rather than guessing whether the day was simply omitted.
  const days = enumerateDateKeys(input.from, input.to).map((date) => ({
    date,
    slots: (grouped.get(date) ?? []).map((slot) => ({
      startUtc: slot.startUtc.toISOString(),
      endUtc: slot.endUtc.toISOString(),
      providerId: slot.providerId,
      providerName: slot.providerName,
    })),
  }));

  return {
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    displayTimezone: input.timezone,
    providerTimezone: request.providers[0]?.timeZone ?? request.businessTimeZone,
    locationType: service.locationType,
    days,
  };
}

/** Lightweight query powering the calendar's enabled/disabled days. */
export async function findAvailableDates(input: SlotQueryInput): Promise<AvailableDatesDto> {
  const { request } = await loadContext(input);
  const slots = generateSlots(request);
  const grouped = groupSlotsByDate(slots, input.timezone);

  return {
    displayTimezone: input.timezone,
    dates: [...grouped.entries()].filter(([, list]) => list.length > 0).map(([date]) => date).sort(),
  };
}

/**
 * Authoritative single-slot check, used by the booking write path before it commits.
 *
 * This is NOT what prevents double booking — two callers can both pass it in the same
 * millisecond. The guarantee is the exclusion constraint. What this does is turn the
 * common cases (outside working hours, during time off, past the notice window) into
 * precise, explainable errors instead of a blanket conflict.
 */
export async function assertSlotBookable(input: {
  serviceId: string;
  providerId: string;
  startsAt: Date;
  now: Date;
  customerId?: string | null;
}): Promise<GeneratedSlot> {
  const { request } = await loadContext({
    serviceId: input.serviceId,
    providerId: input.providerId,
    from: toDateKey(input.startsAt, 'UTC'),
    to: toDateKey(input.startsAt, 'UTC'),
    timezone: 'UTC',
    now: input.now,
    customerId: input.customerId ?? null,
  });

  // Widen by a day each way so a provider-local date that differs from the UTC date is
  // still evaluated.
  const utcKey = toDateKey(input.startsAt, 'UTC');
  request.dateKeys = enumerateDateKeys(addDaysToDateKey(utcKey, -1), addDaysToDateKey(utcKey, 1));

  const match = generateSlots(request).find(
    (slot) => slot.startUtc.getTime() === input.startsAt.getTime(),
  );

  if (!match) {
    throw new AppError(ErrorCode.SLOT_UNAVAILABLE);
  }
  return match;
}
