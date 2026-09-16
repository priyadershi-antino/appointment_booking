import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * The only module permitted to call date-fns-tz.
 *
 * Every other file works in absolute instants (epoch milliseconds) or in local
 * wall-clock minutes plus an IANA zone name. Funnelling all conversion through one place
 * is what keeps daylight-saving bugs findable: there is exactly one function that turns
 * "Monday 09:00 in Asia/Kolkata" into a UTC instant, and it is tested against real DST
 * transition dates rather than trusted.
 *
 * The rule the whole engine depends on: recurring availability is stored as LOCAL
 * wall-clock minutes and expanded per calendar date. Storing it as UTC would be wrong
 * twice a year for every zone that observes DST — a provider who works 09:00–17:00 works
 * those hours in local time, not at a fixed UTC offset.
 */

/** `yyyy-MM-dd`. A calendar date with no time and no zone of its own. */
export type DateKey = string;

export const MINUTES_PER_DAY = 1440;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Splits minutes-from-midnight into a wall-clock `HH:mm`, tolerating 24:00 as 1440. */
export function minutesToWallClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${pad2(hours)}:${pad2(minutes % 60)}`;
}

export function wallClockToMinutes(value: string): number {
  const [hours, mins] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (mins ?? 0);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Formats an instant as the calendar date it falls on in `timeZone`. */
export function toDateKey(instant: Date | number, timeZone: string): DateKey {
  return formatInTimeZone(new Date(instant), timeZone, 'yyyy-MM-dd');
}

/** Formats an instant as `HH:mm` local to `timeZone`. */
export function toWallClock(instant: Date | number, timeZone: string): string {
  return formatInTimeZone(new Date(instant), timeZone, 'HH:mm');
}

/** 0 = Sunday, matching the JavaScript Date#getDay convention. */
export function weekdayOf(dateKey: DateKey): number {
  // Anchored at UTC noon so the weekday cannot slip across a date boundary.
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

export function addDaysToDateKey(dateKey: DateKey, days: number): DateKey {
  const anchor = new Date(`${dateKey}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/** Inclusive list of calendar dates between two keys. */
export function enumerateDateKeys(from: DateKey, to: DateKey): DateKey[] {
  const keys: DateKey[] = [];
  let cursor = from;
  // Bounded so a malformed range cannot spin forever.
  for (let guard = 0; guard < 400 && cursor <= to; guard += 1) {
    keys.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }
  return keys;
}

export interface LocalConversion {
  instant: Date;
  /**
   * `none`      — the wall time exists once, unambiguously.
   * `ambiguous` — it occurs twice (clocks went back); the EARLIER occurrence is returned.
   * `shifted`   — it does not exist (clocks went forward); the time was clamped forward
   *               to the first instant that does exist.
   */
  resolution: 'none' | 'ambiguous' | 'shifted';
}

const HOUR_MS = 3_600_000;

/**
 * Turns a local wall-clock time into an absolute instant, resolving both DST anomalies
 * explicitly rather than accepting whatever the library happens to return.
 *
 * Spring forward: 02:30 simply does not exist on the transition date. A working-hours
 * window that begins there is clamped forward to the first real instant, so the provider
 * loses the missing hour rather than the whole day.
 *
 * Fall back: 01:30 happens twice. We always take the earlier occurrence, everywhere, so
 * that a slot list generated at one moment matches the booking written a minute later.
 * Silently differing on this is how an appointment ends up an hour from where it was
 * shown.
 */
export function localToUtc(
  dateKey: DateKey,
  minutesFromMidnight: number,
  timeZone: string,
): LocalConversion {
  // 1440 means end-of-day, which is midnight on the following date.
  let effectiveDate = dateKey;
  let minutes = minutesFromMidnight;
  while (minutes >= MINUTES_PER_DAY) {
    minutes -= MINUTES_PER_DAY;
    effectiveDate = addDaysToDateKey(effectiveDate, 1);
  }

  const wall = `${effectiveDate}T${minutesToWallClock(minutes)}:00`;
  const candidate = fromZonedTime(wall, timeZone);

  // Round-trip: if formatting the result back does not reproduce the requested wall
  // time, that wall time does not exist on this date in this zone.
  const roundTrip = formatInTimeZone(candidate, timeZone, "yyyy-MM-dd'T'HH:mm:ss");
  if (roundTrip !== wall) {
    return { instant: clampForward(effectiveDate, minutes, timeZone), resolution: 'shifted' };
  }

  // If the instant an hour earlier renders as the same wall time, the clock was set back
  // and this wall time occurs twice. Prefer the earlier occurrence.
  const earlier = new Date(candidate.getTime() - HOUR_MS);
  if (formatInTimeZone(earlier, timeZone, "yyyy-MM-dd'T'HH:mm:ss") === wall) {
    return { instant: earlier, resolution: 'ambiguous' };
  }

  return { instant: candidate, resolution: 'none' };
}

/** Walks forward a minute at a time until the wall time exists. The gap is at most 2h. */
function clampForward(dateKey: DateKey, minutes: number, timeZone: string): Date {
  for (let offset = 1; offset <= 180; offset += 1) {
    const probe = minutes + offset;
    if (probe >= MINUTES_PER_DAY) break;
    const wall = `${dateKey}T${minutesToWallClock(probe)}:00`;
    const candidate = fromZonedTime(wall, timeZone);
    if (formatInTimeZone(candidate, timeZone, "yyyy-MM-dd'T'HH:mm:ss") === wall) {
      return candidate;
    }
  }
  // Fall back to the library result rather than throwing; a lost window is recoverable,
  // a crashed availability query is not.
  return fromZonedTime(`${dateKey}T${minutesToWallClock(minutes)}:00`, timeZone);
}

/** Convenience: the UTC instant of local midnight starting `dateKey`. */
export function startOfLocalDay(dateKey: DateKey, timeZone: string): Date {
  return localToUtc(dateKey, 0, timeZone).instant;
}

/** Convenience: the UTC instant of the following local midnight (exclusive end of day). */
export function endOfLocalDay(dateKey: DateKey, timeZone: string): Date {
  return localToUtc(addDaysToDateKey(dateKey, 1), 0, timeZone).instant;
}

/**
 * Minutes from local midnight for an instant. Note this can exceed or undershoot the
 * wall-clock arithmetic on a DST day, which is exactly why slot grids are built by
 * stepping wall-clock minutes rather than by adding milliseconds.
 */
export function minutesSinceLocalMidnight(instant: Date, timeZone: string): number {
  return wallClockToMinutes(toWallClock(instant, timeZone));
}

/** Human-facing formatting, used for confirmations and notification templates. */
export function formatLocal(instant: Date, timeZone: string, pattern: string): string {
  return formatInTimeZone(instant, timeZone, pattern);
}

/** The offset label a UI shows next to a time, e.g. `GMT+5:30`. */
export function timeZoneLabel(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'zzz');
}

export { toZonedTime };
