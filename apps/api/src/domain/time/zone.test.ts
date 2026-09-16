import { describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  endOfLocalDay,
  enumerateDateKeys,
  localToUtc,
  minutesToWallClock,
  startOfLocalDay,
  toDateKey,
  toWallClock,
  wallClockToMinutes,
  weekdayOf,
} from './zone.js';

describe('wall-clock helpers', () => {
  it('round-trips minutes and HH:mm', () => {
    expect(minutesToWallClock(0)).toBe('00:00');
    expect(minutesToWallClock(540)).toBe('09:00');
    expect(minutesToWallClock(1035)).toBe('17:15');
    expect(wallClockToMinutes('09:00')).toBe(540);
    expect(wallClockToMinutes('17:15')).toBe(1035);
  });

  it('treats 1440 as the end of the day', () => {
    expect(minutesToWallClock(1440)).toBe('24:00');
  });
});

describe('calendar arithmetic', () => {
  it('reports weekday with 0 = Sunday', () => {
    // 2026-09-20 is a Sunday, 2026-09-21 a Monday.
    expect(weekdayOf('2026-09-20')).toBe(0);
    expect(weekdayOf('2026-09-21')).toBe(1);
  });

  it('crosses month and year boundaries', () => {
    expect(addDaysToDateKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap day', () => {
    expect(addDaysToDateKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(weekdayOf('2028-02-29')).toBe(2);
  });

  it('enumerates an inclusive range', () => {
    expect(enumerateDateKeys('2026-09-19', '2026-09-22')).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ]);
  });
});

describe('localToUtc in a zone without DST', () => {
  const IST = 'Asia/Kolkata';

  it('applies the +05:30 offset', () => {
    const { instant, resolution } = localToUtc('2026-09-21', 540, IST);
    expect(instant.toISOString()).toBe('2026-09-21T03:30:00.000Z');
    expect(resolution).toBe('none');
  });

  it('is stable across the dates when other zones shift', () => {
    // India does not observe DST, so March and November look identical.
    expect(localToUtc('2026-03-08', 540, IST).instant.toISOString()).toBe(
      '2026-03-08T03:30:00.000Z',
    );
    expect(localToUtc('2026-11-01', 540, IST).instant.toISOString()).toBe(
      '2026-11-01T03:30:00.000Z',
    );
  });

  it('rolls 1440 into the next local midnight', () => {
    const endOfDay = localToUtc('2026-09-21', 1440, IST).instant;
    expect(endOfDay.toISOString()).toBe('2026-09-21T18:30:00.000Z');
    expect(toDateKey(endOfDay, IST)).toBe('2026-09-22');
  });
});

describe('localToUtc across a spring-forward transition', () => {
  // US DST 2026 begins Sunday 8 March: 02:00 becomes 03:00, so 02:00-02:59 never happens.
  const NY = 'America/New_York';

  it('resolves times before the gap normally', () => {
    const before = localToUtc('2026-03-08', 60, NY);
    expect(before.resolution).toBe('none');
    expect(before.instant.toISOString()).toBe('2026-03-08T06:00:00.000Z');
  });

  it('clamps a nonexistent wall time forward instead of silently shifting it', () => {
    const missing = localToUtc('2026-03-08', 150, NY); // 02:30, which does not exist
    expect(missing.resolution).toBe('shifted');
    // The first real instant after the gap is 03:00 EDT = 07:00Z.
    expect(missing.instant.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(toWallClock(missing.instant, NY)).toBe('03:00');
  });

  it('resolves times after the gap on the new offset', () => {
    const after = localToUtc('2026-03-08', 540, NY); // 09:00 EDT
    expect(after.resolution).toBe('none');
    expect(after.instant.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('makes the transition day 23 hours long', () => {
    const start = startOfLocalDay('2026-03-08', NY).getTime();
    const end = endOfLocalDay('2026-03-08', NY).getTime();
    expect((end - start) / 3_600_000).toBe(23);
  });
});

describe('localToUtc across a fall-back transition', () => {
  // US DST 2026 ends Sunday 1 November: 02:00 becomes 01:00, so 01:00-01:59 happens twice.
  const NY = 'America/New_York';

  it('takes the earlier occurrence of an ambiguous wall time', () => {
    const ambiguous = localToUtc('2026-11-01', 90, NY); // 01:30, twice over
    expect(ambiguous.resolution).toBe('ambiguous');
    // Earlier occurrence is still EDT (UTC-4) => 05:30Z. The later one would be 06:30Z.
    expect(ambiguous.instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(toWallClock(ambiguous.instant, NY)).toBe('01:30');
  });

  it('is deterministic — repeated calls never drift to the other occurrence', () => {
    const first = localToUtc('2026-11-01', 90, NY).instant.toISOString();
    for (let i = 0; i < 5; i += 1) {
      expect(localToUtc('2026-11-01', 90, NY).instant.toISOString()).toBe(first);
    }
  });

  it('resolves unambiguous times on the same day normally', () => {
    const morning = localToUtc('2026-11-01', 540, NY); // 09:00 EST
    expect(morning.resolution).toBe('none');
    expect(morning.instant.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('makes the transition day 25 hours long', () => {
    const start = startOfLocalDay('2026-11-01', NY).getTime();
    const end = endOfLocalDay('2026-11-01', NY).getTime();
    expect((end - start) / 3_600_000).toBe(25);
  });
});

describe('localToUtc in a southern-hemisphere zone', () => {
  // Australia shifts in the opposite direction to the US, which catches logic that
  // assumes DST always means "clocks go forward in March".
  const SYD = 'Australia/Sydney';

  it('handles the April fall-back', () => {
    const ambiguous = localToUtc('2026-04-05', 150, SYD); // 02:30 occurs twice
    expect(ambiguous.resolution).toBe('ambiguous');
    expect(toWallClock(ambiguous.instant, SYD)).toBe('02:30');
  });

  it('handles the October spring-forward', () => {
    const missing = localToUtc('2026-10-04', 150, SYD); // 02:30 does not exist
    expect(missing.resolution).toBe('shifted');
    expect(toWallClock(missing.instant, SYD)).toBe('03:00');
  });
});

describe('toDateKey', () => {
  it('assigns an instant to the correct local date either side of midnight', () => {
    // 18:29Z on the 21st is 23:59 IST the same day; one minute later it is the 22nd.
    expect(toDateKey(new Date('2026-09-21T18:29:00Z'), 'Asia/Kolkata')).toBe('2026-09-21');
    expect(toDateKey(new Date('2026-09-21T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-09-22');
  });

  it('places the same instant on different dates in different zones', () => {
    const instant = new Date('2026-09-21T02:00:00Z');
    expect(toDateKey(instant, 'Asia/Kolkata')).toBe('2026-09-21');
    expect(toDateKey(instant, 'America/New_York')).toBe('2026-09-20');
  });
});
