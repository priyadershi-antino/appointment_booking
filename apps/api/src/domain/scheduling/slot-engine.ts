import {
  fitsWithinAny,
  interval,
  mergeIntervals,
  overlapsAny,
  subtractIntervals,
  type Interval,
} from '../time/interval.js';
import { addDaysToDateKey, localToUtc, toDateKey, weekdayOf, type DateKey } from '../time/zone.js';

/**
 * The slot engine.
 *
 * Pure: no database, no Express, no clock of its own. Everything it needs arrives in a
 * SlotRequest and it returns plain data. That is deliberate — this is the one piece of
 * the system where being wrong is expensive and silent, so it has to be testable without
 * standing anything up.
 *
 * Two rules govern every decision here and they are NOT the same rule:
 *
 *   BOOKABILITY  [start, start+duration)                      must fit inside published hours.
 *   OCCUPANCY    [start-bufferBefore, start+duration+bufferAfter)  must not touch anything busy.
 *
 * Buffers therefore protect against neighbouring appointments but are allowed to spill
 * past the edge of the working day: a 10-minute prep buffer before a 09:00 appointment
 * does not require the provider to open at 08:50.
 *
 * Buffers also STACK rather than merge. The gap required between two appointments is the
 * first one's trailing buffer plus the second one's leading buffer, because each
 * appointment reserves its own buffered footprint and those footprints may not overlap.
 */

export interface WeeklyRule {
  /** 0 = Sunday. */
  weekday: number;
  /** Local wall-clock minutes from midnight, in the provider's zone. */
  startMinute: number;
  endMinute: number;
}

export interface DateOverride {
  dateKey: DateKey;
  type: 'UNAVAILABLE' | 'CUSTOM_HOURS';
  windows: { startMinute: number; endMinute: number }[];
}

export interface ProviderSchedule {
  providerId: string;
  providerName: string;
  /** IANA zone the weekly rules are expressed in. */
  timeZone: string;
  weeklyRules: WeeklyRule[];
  /** Keyed by the provider-local date the override applies to. */
  overrides: Map<DateKey, DateOverride>;
  /** Absolute intervals: vacation, sick leave, ad-hoc blocks. */
  timeOff: Interval[];
  /** Absolute BUFFERED intervals of existing appointments that still occupy the calendar. */
  busy: Interval[];
  /** Existing occupying appointment count per provider-local date, for the daily cap. */
  bookingsByDate: Map<DateKey, number>;
}

export interface ServiceRules {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** Distinct from duration: a 30-minute service may start every 15 minutes. */
  slotIntervalMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
  /** Null means no ceiling. */
  maxPerDay: number | null;
  maxPerCustomerPerDay: number | null;
}

export interface SlotRequest {
  service: ServiceRules;
  providers: ProviderSchedule[];
  /** Business-wide closures, as calendar dates in the business zone. */
  holidays: Set<DateKey>;
  businessTimeZone: string;
  /** Provider-local dates to evaluate. */
  dateKeys: DateKey[];
  /** Injected, never read from the system clock — this is what makes notice rules testable. */
  now: Date;
  /** Existing bookings for the requesting customer, per business-local date. */
  customerBookingsByDate?: Map<DateKey, number>;
}

export interface GeneratedSlot {
  startUtc: Date;
  endUtc: Date;
  providerId: string;
  providerName: string;
}

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

/**
 * Turns a provider's rules for one calendar date into absolute availability windows.
 *
 * An override REPLACES that date's recurring rules rather than merging with them. "On the
 * 20th I work 11:00-15:00" means instead of the usual hours, not in addition to them —
 * merging would leave the provider exposed during hours they explicitly withdrew.
 */
export function availabilityWindowsFor(
  provider: ProviderSchedule,
  dateKey: DateKey,
): Interval[] {
  const override = provider.overrides.get(dateKey);

  let windows: { startMinute: number; endMinute: number }[];
  if (override) {
    if (override.type === 'UNAVAILABLE') return [];
    windows = override.windows;
  } else {
    const weekday = weekdayOf(dateKey);
    windows = provider.weeklyRules.filter((rule) => rule.weekday === weekday);
  }

  const intervals: Interval[] = [];
  for (const window of windows) {
    if (window.endMinute <= window.startMinute) continue;

    // Each endpoint is converted independently through the DST-aware resolver, so a
    // window that straddles a transition comes out with the right real duration.
    const start = localToUtc(dateKey, window.startMinute, provider.timeZone).instant;
    const end = localToUtc(
      dateKey,
      Math.min(window.endMinute, MINUTES_PER_DAY),
      provider.timeZone,
    ).instant;

    if (end.getTime() > start.getTime()) {
      intervals.push(interval(start.getTime(), end.getTime()));
    }
  }

  return mergeIntervals(intervals);
}

/**
 * Candidate start instants for one date, stepped in LOCAL wall-clock minutes.
 *
 * Stepping wall-clock minutes rather than adding milliseconds is what keeps the grid
 * aligned across a daylight-saving change: after a transition the offset moves, but
 * 09:00, 09:15, 09:30 remain 09:00, 09:15, 09:30 to the customer. Grid points that fall
 * into a spring-forward gap do not exist as instants and are dropped.
 *
 * The grid is anchored at the PROVIDER's local midnight, because it is their calendar and
 * their published hours the customer is reading.
 */
export function gridStartsFor(
  provider: ProviderSchedule,
  dateKey: DateKey,
  slotIntervalMin: number,
): Date[] {
  const step = Math.max(1, Math.floor(slotIntervalMin));
  const starts: Date[] = [];

  for (let minute = 0; minute < MINUTES_PER_DAY; minute += step) {
    const resolved = localToUtc(dateKey, minute, provider.timeZone);
    // A wall time that does not exist cannot be offered as a start time.
    if (resolved.resolution === 'shifted') continue;
    starts.push(resolved.instant);
  }

  return starts;
}

interface DateWindowBudget {
  providerRemaining: number;
  customerRemaining: number;
}

function budgetFor(
  provider: ProviderSchedule,
  service: ServiceRules,
  providerDateKey: DateKey,
  businessDateKey: DateKey,
  customerBookings: Map<DateKey, number> | undefined,
): DateWindowBudget {
  const providerUsed = provider.bookingsByDate.get(providerDateKey) ?? 0;
  const customerUsed = customerBookings?.get(businessDateKey) ?? 0;

  return {
    providerRemaining:
      service.maxPerDay === null ? Number.POSITIVE_INFINITY : service.maxPerDay - providerUsed,
    customerRemaining:
      service.maxPerCustomerPerDay === null
        ? Number.POSITIVE_INFINITY
        : service.maxPerCustomerPerDay - customerUsed,
  };
}

/**
 * Generates every bookable start time for one provider across the requested dates.
 *
 * The daily caps applied here are advisory: they stop the UI from offering a slot that
 * would be refused, but the authoritative check happens inside the booking transaction
 * under an advisory lock, because two customers can pass this check simultaneously.
 */
export function generateSlotsForProvider(
  request: SlotRequest,
  provider: ProviderSchedule,
): GeneratedSlot[] {
  const { service, now } = request;
  const durationMs = service.durationMin * MS_PER_MINUTE;
  const leadMs = service.bufferBeforeMin * MS_PER_MINUTE;
  const trailMs = service.bufferAfterMin * MS_PER_MINUTE;

  const earliest = now.getTime() + service.minNoticeMin * MS_PER_MINUTE;
  const horizonKey = addDaysToDateKey(
    toDateKey(now, request.businessTimeZone),
    service.maxAdvanceDays,
  );

  const slots: GeneratedSlot[] = [];

  for (const dateKey of request.dateKeys) {
    // Holidays are business-wide and expressed in business-local dates.
    const businessDateKeyForDay = dateKey;
    if (request.holidays.has(businessDateKeyForDay)) continue;
    if (dateKey > horizonKey) continue;

    const windows = availabilityWindowsFor(provider, dateKey);
    if (windows.length === 0) continue;

    // Time off carves into published hours; existing appointments do not (they are
    // handled by the occupancy test, which accounts for buffers on both sides).
    const openWindows = subtractIntervals(windows, provider.timeOff);
    if (openWindows.length === 0) continue;

    const budget = budgetFor(provider, service, dateKey, businessDateKeyForDay, request.customerBookingsByDate);
    if (budget.providerRemaining <= 0 || budget.customerRemaining <= 0) continue;

    for (const start of gridStartsFor(provider, dateKey, service.slotIntervalMin)) {
      const startMs = start.getTime();
      const endMs = startMs + durationMs;

      // Minimum notice, evaluated against the injected clock.
      if (startMs < earliest) continue;

      // BOOKABILITY — the appointment body must sit inside one published window.
      if (!fitsWithinAny(openWindows, interval(startMs, endMs))) continue;

      // OCCUPANCY — the full buffered footprint must clear every existing booking.
      if (overlapsAny(provider.busy, interval(startMs - leadMs, endMs + trailMs))) continue;

      slots.push({
        startUtc: new Date(startMs),
        endUtc: new Date(endMs),
        providerId: provider.providerId,
        providerName: provider.providerName,
      });
    }
  }

  return slots;
}

/**
 * Full slot query, including the "any provider" case.
 *
 * When several providers can take the same time, the least-loaded one is offered, with
 * the provider id as a deterministic tiebreak so repeated identical queries return
 * identical answers — a customer refreshing the page should not see the assigned
 * practitioner flicker.
 */
export function generateSlots(request: SlotRequest): GeneratedSlot[] {
  const byStart = new Map<number, GeneratedSlot[]>();

  for (const provider of request.providers) {
    for (const slot of generateSlotsForProvider(request, provider)) {
      const key = slot.startUtc.getTime();
      const bucket = byStart.get(key);
      if (bucket) bucket.push(slot);
      else byStart.set(key, [slot]);
    }
  }

  const loadOf = (providerId: string): number => {
    const provider = request.providers.find((p) => p.providerId === providerId);
    if (!provider) return 0;
    let total = 0;
    for (const count of provider.bookingsByDate.values()) total += count;
    return total;
  };

  const chosen: GeneratedSlot[] = [];
  for (const [, candidates] of byStart) {
    candidates.sort((a, b) => {
      const byLoad = loadOf(a.providerId) - loadOf(b.providerId);
      if (byLoad !== 0) return byLoad;
      return a.providerId.localeCompare(b.providerId);
    });
    chosen.push(candidates[0]!);
  }

  return chosen.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
}

/** Groups slots by their calendar date in the display zone, for the booking UI. */
export function groupSlotsByDate(
  slots: GeneratedSlot[],
  displayTimeZone: string,
): Map<DateKey, GeneratedSlot[]> {
  const grouped = new Map<DateKey, GeneratedSlot[]>();
  for (const slot of slots) {
    const key = toDateKey(slot.startUtc, displayTimeZone);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(slot);
    else grouped.set(key, [slot]);
  }
  return grouped;
}
