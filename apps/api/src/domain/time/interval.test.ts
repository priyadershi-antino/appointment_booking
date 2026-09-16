import { describe, expect, it } from 'vitest';
import {
  contains,
  durationMs,
  fitsWithinAny,
  interval,
  intersectIntervals,
  isEmpty,
  mergeIntervals,
  overlaps,
  overlapsAny,
  subtractIntervals,
  totalDuration,
} from './interval.js';

/** Minutes-since-zero shorthand keeps these tests readable. */
const m = (minutes: number) => minutes * 60_000;
const iv = (startMin: number, endMin: number) => interval(m(startMin), m(endMin));
const asPairs = (intervals: { start: number; end: number }[]) =>
  intervals.map((i) => [i.start / 60_000, i.end / 60_000]);

describe('overlaps', () => {
  it('is false for intervals that merely touch', () => {
    // The whole half-open convention rests on this: an appointment ending at 14:30 and
    // one starting at 14:30 are adjacent, not conflicting.
    expect(overlaps(iv(0, 30), iv(30, 60))).toBe(false);
    expect(overlaps(iv(30, 60), iv(0, 30))).toBe(false);
  });

  it('is true for any shared instant', () => {
    expect(overlaps(iv(0, 30), iv(29, 60))).toBe(true);
    expect(overlaps(iv(0, 60), iv(10, 20))).toBe(true);
    expect(overlaps(iv(10, 20), iv(0, 60))).toBe(true);
  });

  it('is false for empty intervals', () => {
    expect(overlaps(iv(10, 10), iv(0, 60))).toBe(false);
  });
});

describe('mergeIntervals', () => {
  it('sorts, fuses overlaps, and drops empties', () => {
    const merged = mergeIntervals([iv(60, 90), iv(0, 30), iv(20, 40), iv(50, 50)]);
    expect(asPairs(merged)).toEqual([
      [0, 40],
      [60, 90],
    ]);
  });

  it('fuses intervals that only touch', () => {
    // Morning and afternoon windows split by a nominal lunch that is not actually a
    // break become one continuous stretch, so an appointment may straddle the seam.
    const merged = mergeIntervals([iv(540, 780), iv(780, 1080)]);
    expect(asPairs(merged)).toEqual([[540, 1080]]);
  });

  it('does not mutate its input', () => {
    const input = [iv(0, 30), iv(20, 40)];
    const snapshot = JSON.stringify(input);
    mergeIntervals(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('returns an empty list for no input', () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe('subtractIntervals', () => {
  it('punches a hole in the middle', () => {
    const result = subtractIntervals([iv(540, 1020)], [iv(720, 780)]);
    expect(asPairs(result)).toEqual([
      [540, 720],
      [780, 1020],
    ]);
  });

  it('trims the leading and trailing edges', () => {
    expect(asPairs(subtractIntervals([iv(540, 1020)], [iv(500, 600)]))).toEqual([[600, 1020]]);
    expect(asPairs(subtractIntervals([iv(540, 1020)], [iv(960, 1100)]))).toEqual([[540, 960]]);
  });

  it('removes a window covered entirely', () => {
    expect(subtractIntervals([iv(540, 1020)], [iv(0, 1440)])).toEqual([]);
  });

  it('applies several blockers at once', () => {
    const result = subtractIntervals([iv(540, 1080)], [iv(600, 630), iv(780, 840), iv(1000, 1020)]);
    expect(asPairs(result)).toEqual([
      [540, 600],
      [630, 780],
      [840, 1000],
      [1020, 1080],
    ]);
  });

  it('handles overlapping blockers without double-cutting', () => {
    const result = subtractIntervals([iv(540, 1080)], [iv(600, 700), iv(650, 750)]);
    expect(asPairs(result)).toEqual([
      [540, 600],
      [750, 1080],
    ]);
  });

  it('leaves the base untouched when a blocker merely touches it', () => {
    expect(asPairs(subtractIntervals([iv(540, 1020)], [iv(1020, 1080)]))).toEqual([[540, 1020]]);
    expect(asPairs(subtractIntervals([iv(540, 1020)], [iv(480, 540)]))).toEqual([[540, 1020]]);
  });

  it('subtracts across multiple base windows', () => {
    const result = subtractIntervals([iv(540, 780), iv(840, 1080)], [iv(700, 900)]);
    expect(asPairs(result)).toEqual([
      [540, 700],
      [900, 1080],
    ]);
  });
});

describe('intersectIntervals', () => {
  it('keeps only shared stretches', () => {
    const result = intersectIntervals([iv(540, 780), iv(840, 1080)], [iv(700, 900)]);
    expect(asPairs(result)).toEqual([
      [700, 780],
      [840, 900],
    ]);
  });

  it('returns nothing when there is no overlap', () => {
    expect(intersectIntervals([iv(0, 60)], [iv(60, 120)])).toEqual([]);
  });
});

describe('fitsWithinAny', () => {
  const windows = [iv(540, 780), iv(840, 1080)];

  it('accepts a candidate inside one window', () => {
    expect(fitsWithinAny(windows, iv(600, 630))).toBe(true);
  });

  it('accepts a candidate flush against the edges', () => {
    expect(fitsWithinAny(windows, iv(540, 570))).toBe(true);
    expect(fitsWithinAny(windows, iv(1050, 1080))).toBe(true);
  });

  it('rejects a candidate straddling the gap between windows', () => {
    // Fitting must be within a SINGLE window: 12:30-14:30 spans the closed lunch hour.
    expect(fitsWithinAny(windows, iv(750, 870))).toBe(false);
  });

  it('rejects a candidate overhanging an edge', () => {
    expect(fitsWithinAny(windows, iv(1060, 1090))).toBe(false);
    expect(fitsWithinAny(windows, iv(530, 560))).toBe(false);
  });
});

describe('overlapsAny', () => {
  const busy = [iv(590, 640), iv(720, 780)];

  it('detects a collision', () => {
    expect(overlapsAny(busy, iv(630, 660))).toBe(true);
  });

  it('allows a candidate that merely touches a blocker', () => {
    // Buffered blocks that abut are legal — this is what lets back-to-back
    // appointments exist once their buffers are accounted for.
    expect(overlapsAny(busy, iv(640, 680))).toBe(false);
    expect(overlapsAny(busy, iv(560, 590))).toBe(false);
  });

  it('is false against no blockers', () => {
    expect(overlapsAny([], iv(0, 1440))).toBe(false);
  });
});

describe('misc helpers', () => {
  it('measures duration and emptiness', () => {
    expect(durationMs(iv(540, 570))).toBe(m(30));
    expect(isEmpty(iv(540, 540))).toBe(true);
    expect(isEmpty(iv(540, 541))).toBe(false);
  });

  it('reports containment', () => {
    expect(contains(iv(540, 1020), iv(600, 630))).toBe(true);
    expect(contains(iv(540, 1020), iv(1000, 1100))).toBe(false);
  });

  it('totals duration after merging, without double counting', () => {
    expect(totalDuration([iv(0, 60), iv(30, 90)])).toBe(m(90));
  });
});
