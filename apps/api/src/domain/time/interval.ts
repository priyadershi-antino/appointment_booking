/**
 * Half-open interval arithmetic: [start, end).
 *
 * Every interval in the scheduling engine is half-open, and that choice is load-bearing
 * rather than stylistic. It makes "ends at 14:30" and "starts at 14:30" adjacent rather
 * than overlapping, which is what lets back-to-back appointments with no buffer coexist.
 * The PostgreSQL exclusion constraint uses the same '[)' bounds, so the engine and the
 * database agree on what "touching" means — if they disagreed, the engine would offer
 * slots the database then rejects.
 *
 * Everything here is pure: numbers in, numbers out, no clock, no database, no timezone
 * logic. That is what makes it exhaustively testable.
 */
export interface Interval {
  /** Inclusive start, epoch milliseconds. */
  start: number;
  /** Exclusive end, epoch milliseconds. */
  end: number;
}

export const MINUTE_MS = 60_000;

export function interval(start: number, end: number): Interval {
  return { start, end };
}

export function fromDates(start: Date, end: Date): Interval {
  return { start: start.getTime(), end: end.getTime() };
}

export function isEmpty(i: Interval): boolean {
  return i.end <= i.start;
}

export function durationMs(i: Interval): number {
  return Math.max(0, i.end - i.start);
}

/**
 * True when the intervals share at least one instant. Touching endpoints do NOT overlap.
 *
 * An empty interval overlaps nothing, matching PostgreSQL, where `&&` against an empty
 * tstzrange is always false. The engine and the exclusion constraint have to agree on
 * this exactly, or the engine would offer a slot the database then refuses.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  if (isEmpty(a) || isEmpty(b)) return false;
  return a.start < b.end && b.start < a.end;
}

/** True when `inner` lies entirely within `outer`, endpoints included. */
export function contains(outer: Interval, inner: Interval): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * Sorts, drops empties, and fuses anything that overlaps or merely touches. Adjacent
 * windows are fused deliberately: a provider working 09:00–13:00 and 13:00–18:00 has one
 * continuous stretch, and an appointment may straddle 13:00.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => !isEmpty(i)).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];

  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged;
}

/**
 * base minus subtrahends. The workhorse of slot generation: availability windows minus
 * holidays, time off, blocked time and existing buffered appointments leaves exactly the
 * stretches that are genuinely free.
 */
export function subtractIntervals(
  base: readonly Interval[],
  subtrahends: readonly Interval[],
): Interval[] {
  const blockers = mergeIntervals(subtrahends);
  if (blockers.length === 0) return mergeIntervals(base);

  const result: Interval[] = [];

  for (const window of mergeIntervals(base)) {
    let cursor = window.start;

    for (const blocker of blockers) {
      if (blocker.end <= cursor) continue;
      if (blocker.start >= window.end) break;

      if (blocker.start > cursor) {
        result.push({ start: cursor, end: Math.min(blocker.start, window.end) });
      }
      cursor = Math.max(cursor, blocker.end);
      if (cursor >= window.end) break;
    }

    if (cursor < window.end) {
      result.push({ start: cursor, end: window.end });
    }
  }

  return result.filter((i) => !isEmpty(i));
}

/** Pairwise intersection of two interval sets. */
export function intersectIntervals(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const left = mergeIntervals(a);
  const right = mergeIntervals(b);
  const result: Interval[] = [];

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i]!.start, right[j]!.start);
    const end = Math.min(left[i]!.end, right[j]!.end);
    if (start < end) result.push({ start, end });

    if (left[i]!.end < right[j]!.end) i += 1;
    else j += 1;
  }

  return result;
}

/**
 * True when `candidate` fits entirely inside at least one of `windows`.
 *
 * Used for the BOOKABILITY test: the customer-facing appointment body must land inside
 * published working hours. Note this is tested against availability only — buffers are
 * deliberately excluded, because a 10-minute prep buffer before a 09:00 appointment is
 * allowed to sit outside the 09:00 opening time. Buffers protect the provider from
 * back-to-back appointments; they are not themselves bookable time.
 */
export function fitsWithinAny(windows: readonly Interval[], candidate: Interval): boolean {
  return windows.some((w) => candidate.start >= w.start && candidate.end <= w.end);
}

/**
 * True when `candidate` collides with any of `blockers`.
 *
 * Used for the OCCUPANCY test, where `candidate` is the full buffered footprint
 * [start − bufferBefore, end + bufferAfter] and `blockers` are the buffered footprints of
 * existing appointments. Because both sides carry their own buffers and this comparison
 * is half-open, buffers STACK between neighbours: the gap needed between two
 * appointments is A's trailing buffer plus B's leading buffer, never the larger of the
 * two. Merging them would quietly halve the breathing room a provider configured.
 */
export function overlapsAny(blockers: readonly Interval[], candidate: Interval): boolean {
  return blockers.some((b) => overlaps(b, candidate));
}

/** Total covered time, after merging. Used for provider utilisation figures. */
export function totalDuration(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + durationMs(i), 0);
}
