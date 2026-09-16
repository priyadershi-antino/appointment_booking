import { describe, expect, it } from 'vitest';
import { interval } from '../time/interval.js';
import { localToUtc, toWallClock } from '../time/zone.js';
import {
  availabilityWindowsFor,
  generateSlots,
  generateSlotsForProvider,
  type ProviderSchedule,
  type ServiceRules,
  type SlotRequest,
} from './slot-engine.js';

const IST = 'Asia/Kolkata';
/** 2026-09-21 is a Monday. */
const MONDAY = '2026-09-21';

/** Local wall-clock time on the test Monday, as an absolute instant. */
const at = (wall: string, dateKey = MONDAY, zone = IST): Date => {
  const [h, m] = wall.split(':').map(Number);
  return localToUtc(dateKey, (h ?? 0) * 60 + (m ?? 0), zone).instant;
};

const localTimes = (slots: { startUtc: Date }[], zone = IST): string[] =>
  slots.map((s) => toWallClock(s.startUtc, zone));

function provider(overrides: Partial<ProviderSchedule> = {}): ProviderSchedule {
  return {
    providerId: 'p1',
    providerName: 'Dr Anita Rao',
    timeZone: IST,
    // Monday 09:00-17:00.
    weeklyRules: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
    overrides: new Map(),
    timeOff: [],
    busy: [],
    bookingsByDate: new Map(),
    ...overrides,
  };
}

function service(overrides: Partial<ServiceRules> = {}): ServiceRules {
  return {
    durationMin: 30,
    bufferBeforeMin: 10,
    bufferAfterMin: 10,
    slotIntervalMin: 15,
    minNoticeMin: 0,
    maxAdvanceDays: 365,
    maxPerDay: null,
    maxPerCustomerPerDay: null,
    ...overrides,
  };
}

function request(overrides: Partial<SlotRequest> = {}): SlotRequest {
  return {
    service: service(),
    providers: [provider()],
    holidays: new Set(),
    businessTimeZone: IST,
    dateKeys: [MONDAY],
    // Well before the test Monday, so notice rules never interfere unless asked.
    now: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The specification's acceptance case, pinned exactly.
//
// Provider Monday 09:00-17:00. Service 30 minutes with 10-minute buffers either
// side. One existing appointment 10:00-10:30, which therefore blocks 09:50-10:40.
//
// A new booking at t occupies [t-10, t+40]. Clearing the existing block requires
// t+40 <= 09:50  (so t <= 09:10)  or  t-10 >= 10:40  (so t >= 10:50).
// Fitting inside published hours requires t in [09:00, 16:30].
//
// If anyone changes buffer or boundary semantics, this array breaks loudly and
// they have to consciously re-derive it. That is the point.
// ────────────────────────────────────────────────────────────────────────────
describe('acceptance: 30-minute service with 10-minute buffers around an existing 10:00 booking', () => {
  const existingBooking = interval(at('09:50').getTime(), at('10:40').getTime());

  it('returns exactly the expected 24 start times on a 15-minute grid', () => {
    const slots = generateSlotsForProvider(
      request(),
      provider({ busy: [existingBooking] }),
    );

    expect(localTimes(slots)).toEqual([
      '09:00',
      '11:00',
      '11:15',
      '11:30',
      '11:45',
      '12:00',
      '12:15',
      '12:30',
      '12:45',
      '13:00',
      '13:15',
      '13:30',
      '13:45',
      '14:00',
      '14:15',
      '14:30',
      '14:45',
      '15:00',
      '15:15',
      '15:30',
      '15:45',
      '16:00',
      '16:15',
      '16:30',
    ]);
    expect(slots).toHaveLength(24);
  });

  it('offers 09:10 and 10:50 when the grid is 10 minutes, proving the buffer arithmetic', () => {
    // On a 10-minute grid the exact boundary starts become reachable: 09:10 is the last
    // start whose trailing buffer clears 09:50, and 10:50 the first whose leading buffer
    // clears 10:40.
    const slots = generateSlotsForProvider(
      request({ service: service({ slotIntervalMin: 10 }) }),
      provider({ busy: [existingBooking] }),
    );
    const times = localTimes(slots);

    expect(times.slice(0, 3)).toEqual(['09:00', '09:10', '10:50']);
    expect(times).not.toContain('09:20');
    expect(times).not.toContain('10:40');
    expect(times.at(-1)).toBe('16:30');
  });

  it('never offers a start whose buffered footprint touches the existing booking', () => {
    const slots = generateSlotsForProvider(
      request({ service: service({ slotIntervalMin: 5 }) }),
      provider({ busy: [existingBooking] }),
    );

    for (const slot of slots) {
      const blockStart = slot.startUtc.getTime() - 10 * 60_000;
      const blockEnd = slot.endUtc.getTime() + 10 * 60_000;
      const collides = blockStart < existingBooking.end && existingBooking.start < blockEnd;
      expect(collides).toBe(false);
    }
  });
});

describe('buffers stack between neighbours rather than merging', () => {
  it('requires the sum of both buffers as the gap', () => {
    // An appointment 10:00-10:30 with 10-minute buffers blocks 09:50-10:40. The next
    // bookable start is 10:50 — its own 10-minute lead buffer begins exactly at 10:40.
    // If buffers merged, 10:40 would be offered, halving the provider's breathing room.
    const slots = generateSlotsForProvider(
      request({ service: service({ slotIntervalMin: 10 }) }),
      provider({ busy: [interval(at('09:50').getTime(), at('10:40').getTime())] }),
    );
    const times = localTimes(slots);
    expect(times).toContain('10:50');
    expect(times).not.toContain('10:40');
  });

  it('allows exactly back-to-back bookings when there are no buffers', () => {
    const noBuffers = service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 30 });
    const slots = generateSlotsForProvider(
      request({ service: noBuffers }),
      provider({ busy: [interval(at('10:00').getTime(), at('10:30').getTime())] }),
    );
    const times = localTimes(slots);
    // 09:30 ends exactly at 10:00 and 10:30 starts exactly when the other ends.
    expect(times).toContain('09:30');
    expect(times).toContain('10:30');
    expect(times).not.toContain('10:00');
  });
});

describe('bookability versus occupancy', () => {
  it('allows the first slot even though its lead buffer precedes opening time', () => {
    // 09:00 start with a 10-minute lead buffer implies 08:50, outside published hours.
    // That is fine: buffers guard against neighbouring appointments, they are not
    // themselves bookable time, and nothing else is scheduled at 08:50.
    const slots = generateSlotsForProvider(request(), provider());
    expect(localTimes(slots)[0]).toBe('09:00');
  });

  it('refuses a start whose appointment body would overrun closing time', () => {
    const slots = generateSlotsForProvider(request(), provider());
    // 16:30 + 30 minutes lands exactly on 17:00; 16:45 would overrun.
    expect(localTimes(slots).at(-1)).toBe('16:30');
  });

  it('will not let an appointment straddle a lunch break', () => {
    const splitDay = provider({
      weeklyRules: [
        { weekday: 1, startMinute: 540, endMinute: 780 }, // 09:00-13:00
        { weekday: 1, startMinute: 840, endMinute: 1080 }, // 14:00-18:00
      ],
    });
    const slots = generateSlotsForProvider(
      request({ service: service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 30 }) }),
      splitDay,
    );
    const times = localTimes(slots);

    expect(times).toContain('12:30'); // ends 13:00, flush with the break
    expect(times).not.toContain('13:00'); // would run into the break
    expect(times).not.toContain('13:30');
    expect(times).toContain('14:00'); // afternoon reopens
    expect(times.at(-1)).toBe('17:30');
  });
});

describe('slot interval is independent of duration', () => {
  it('starts a 30-minute service every 15 minutes', () => {
    const slots = generateSlotsForProvider(
      request({
        service: service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 15 }),
      }),
      provider(),
    );
    expect(localTimes(slots).slice(0, 5)).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00']);
  });

  it('starts a 60-minute service every 60 minutes when asked', () => {
    const slots = generateSlotsForProvider(
      request({
        service: service({
          durationMin: 60,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          slotIntervalMin: 60,
        }),
      }),
      provider(),
    );
    expect(localTimes(slots)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
  });
});

describe('availability overrides replace rather than merge', () => {
  it('uses only the override hours for that date', () => {
    const withOverride = provider({
      overrides: new Map([
        [
          MONDAY,
          {
            dateKey: MONDAY,
            type: 'CUSTOM_HOURS' as const,
            windows: [{ startMinute: 660, endMinute: 900 }], // 11:00-15:00
          },
        ],
      ]),
    });

    const slots = generateSlotsForProvider(
      request({ service: service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 30 }) }),
      withOverride,
    );
    const times = localTimes(slots);

    expect(times[0]).toBe('11:00');
    expect(times.at(-1)).toBe('14:30');
    expect(times).not.toContain('09:00');
    expect(times).not.toContain('16:00');
  });

  it('closes the day entirely for an UNAVAILABLE override', () => {
    const closed = provider({
      overrides: new Map([
        [MONDAY, { dateKey: MONDAY, type: 'UNAVAILABLE' as const, windows: [] }],
      ]),
    });
    expect(availabilityWindowsFor(closed, MONDAY)).toEqual([]);
    expect(generateSlotsForProvider(request(), closed)).toEqual([]);
  });
});

describe('time off and holidays remove slots', () => {
  it('removes the covered stretch for partial time off', () => {
    const onLeave = provider({
      timeOff: [interval(at('12:00').getTime(), at('15:00').getTime())],
    });
    const slots = generateSlotsForProvider(
      request({ service: service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 30 }) }),
      onLeave,
    );
    const times = localTimes(slots);

    expect(times).toContain('11:30'); // ends 12:00, flush with the leave
    expect(times).not.toContain('12:00');
    expect(times).not.toContain('14:30');
    expect(times).toContain('15:00');
  });

  it('empties the day for full-day time off', () => {
    const away = provider({
      timeOff: [interval(at('00:00').getTime(), at('00:00', '2026-09-22').getTime())],
    });
    expect(generateSlotsForProvider(request(), away)).toEqual([]);
  });

  it('empties the day for a business holiday', () => {
    const slots = generateSlotsForProvider(
      request({ holidays: new Set([MONDAY]) }),
      provider(),
    );
    expect(slots).toEqual([]);
  });
});

describe('booking window rules', () => {
  it('hides slots inside the minimum notice period', () => {
    // Standing at 09:00 on the day with two hours notice, 11:00 is the first offer.
    const slots = generateSlotsForProvider(
      request({
        service: service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 30, minNoticeMin: 120 }),
        now: at('09:00'),
      }),
      provider(),
    );
    expect(localTimes(slots)[0]).toBe('11:00');
  });

  it('hides dates beyond the advance horizon', () => {
    const nextMonday = '2026-09-28';
    const slots = generateSlotsForProvider(
      request({
        service: service({ maxAdvanceDays: 3 }),
        dateKeys: [MONDAY, nextMonday],
        now: new Date('2026-09-20T00:00:00Z'),
      }),
      provider(),
    );
    // Only the Monday within three days of the 20th survives.
    expect(new Set(slots.map((s) => s.startUtc.toISOString().slice(0, 10)))).toEqual(
      new Set(['2026-09-21']),
    );
  });

  it('closes the day once the provider daily cap is reached', () => {
    const booked = provider({ bookingsByDate: new Map([[MONDAY, 8]]) });
    expect(generateSlotsForProvider(request({ service: service({ maxPerDay: 8 }) }), booked)).toEqual(
      [],
    );
  });

  it('closes the day once the customer per-day cap is reached', () => {
    const slots = generateSlotsForProvider(
      request({
        service: service({ maxPerCustomerPerDay: 1 }),
        customerBookingsByDate: new Map([[MONDAY, 1]]),
      }),
      provider(),
    );
    expect(slots).toEqual([]);
  });
});

describe('daylight saving', () => {
  const NY = 'America/New_York';

  it('drops grid points that fall into a spring-forward gap', () => {
    // 2026-03-08 is a Sunday; give the provider Sunday hours spanning the 02:00 gap.
    const nyProvider = provider({
      timeZone: NY,
      weeklyRules: [{ weekday: 0, startMinute: 0, endMinute: 360 }], // 00:00-06:00
    });
    const slots = generateSlotsForProvider(
      request({
        service: service({
          durationMin: 30,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          slotIntervalMin: 30,
        }),
        dateKeys: ['2026-03-08'],
        businessTimeZone: NY,
        // The default `now` sits in September; these dates are in March, so the clock
        // has to be moved back or the minimum-notice filter correctly removes them all.
        now: new Date('2026-01-01T00:00:00Z'),
      }),
      nyProvider,
    );
    const times = localTimes(slots, NY);

    // 02:00 and 02:30 never happen on this date, so they cannot be offered.
    expect(times).not.toContain('02:00');
    expect(times).not.toContain('02:30');
    expect(times).toContain('01:30');
    expect(times).toContain('03:00');
    // A 23-hour day: six wall-clock hours of availability minus the missing hour.
    expect(times).toHaveLength(10);
  });

  it('keeps wall-clock alignment after a fall-back transition', () => {
    const nyProvider = provider({
      timeZone: NY,
      weeklyRules: [{ weekday: 0, startMinute: 0, endMinute: 360 }],
    });
    const slots = generateSlotsForProvider(
      request({
        service: service({
          durationMin: 30,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          slotIntervalMin: 30,
        }),
        dateKeys: ['2026-11-01'],
        businessTimeZone: NY,
      }),
      nyProvider,
    );
    const times = localTimes(slots, NY);

    // Every offered start is still on a clean half-hour in local time, which is what a
    // customer sees. The repeated 01:00-01:59 hour is offered once, not twice.
    expect(times.every((t) => t.endsWith(':00') || t.endsWith(':30'))).toBe(true);
    expect(times.filter((t) => t === '01:00')).toHaveLength(1);
  });

  it('keeps appointment duration at real elapsed time across a transition', () => {
    const nyProvider = provider({
      timeZone: NY,
      weeklyRules: [{ weekday: 0, startMinute: 0, endMinute: 360 }],
    });
    const slots = generateSlotsForProvider(
      request({
        service: service({
          durationMin: 30,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          slotIntervalMin: 30,
        }),
        dateKeys: ['2026-03-08'],
        businessTimeZone: NY,
        // The default `now` sits in September; these dates are in March, so the clock
        // has to be moved back or the minimum-notice filter correctly removes them all.
        now: new Date('2026-01-01T00:00:00Z'),
      }),
      nyProvider,
    );
    for (const slot of slots) {
      expect(slot.endUtc.getTime() - slot.startUtc.getTime()).toBe(30 * 60_000);
    }
  });
});

describe('cross-timezone providers', () => {
  it('publishes each provider hours in their own zone', () => {
    const inIndia = provider({ providerId: 'ist', providerName: 'Anita', timeZone: IST });
    const inNewYork = provider({
      providerId: 'nyc',
      providerName: 'Sam',
      timeZone: 'America/New_York',
    });

    const istSlots = generateSlotsForProvider(request(), inIndia);
    const nySlots = generateSlotsForProvider(request(), inNewYork);

    // Both start their day at 09:00 local, which are different absolute instants.
    expect(toWallClock(istSlots[0]!.startUtc, IST)).toBe('09:00');
    expect(toWallClock(nySlots[0]!.startUtc, 'America/New_York')).toBe('09:00');
    expect(istSlots[0]!.startUtc.getTime()).not.toBe(nySlots[0]!.startUtc.getTime());
  });
});

describe('any-provider merging', () => {
  it('offers each time once and prefers the least-loaded provider', () => {
    const busyProvider = provider({
      providerId: 'busy',
      providerName: 'Busy',
      bookingsByDate: new Map([[MONDAY, 5]]),
    });
    const freeProvider = provider({
      providerId: 'free',
      providerName: 'Free',
      bookingsByDate: new Map([[MONDAY, 1]]),
    });

    const slots = generateSlots(
      request({
        service: service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 60 }),
        providers: [busyProvider, freeProvider],
      }),
    );

    const times = localTimes(slots);
    expect(new Set(times).size).toBe(times.length);
    expect(slots.every((s) => s.providerId === 'free')).toBe(true);
  });

  it('falls back to the other provider when the preferred one is occupied', () => {
    const occupied = provider({
      providerId: 'a',
      providerName: 'A',
      busy: [interval(at('09:00').getTime(), at('10:00').getTime())],
    });
    const open = provider({ providerId: 'b', providerName: 'B' });

    const slots = generateSlots(
      request({
        service: service({ bufferBeforeMin: 0, bufferAfterMin: 0, slotIntervalMin: 60 }),
        providers: [occupied, open],
      }),
    );

    const nineAm = slots.find((s) => toWallClock(s.startUtc, IST) === '09:00');
    expect(nineAm?.providerId).toBe('b');
  });

  it('returns results sorted by start time', () => {
    const slots = generateSlots(
      request({
        providers: [provider({ providerId: 'a' }), provider({ providerId: 'b' })],
      }),
    );
    const times = slots.map((s) => s.startUtc.getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });
});

describe('empty results', () => {
  it('returns nothing on a day with no weekly rule', () => {
    // 2026-09-23 is a Wednesday and the provider only works Mondays.
    expect(generateSlotsForProvider(request({ dateKeys: ['2026-09-23'] }), provider())).toEqual([]);
  });

  it('returns nothing when the service is longer than any window', () => {
    const slots = generateSlotsForProvider(
      request({ service: service({ durationMin: 600 }) }),
      provider(),
    );
    expect(slots).toEqual([]);
  });
});
