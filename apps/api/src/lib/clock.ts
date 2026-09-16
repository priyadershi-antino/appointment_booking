/**
 * The single source of "now" in the application.
 *
 * Every piece of booking logic that cares about the current time — minimum notice, the
 * maximum advance horizon, cancellation and reschedule deadlines, hold expiry — takes
 * `now` as a parameter rather than reading the clock itself. That is what makes those
 * rules testable: a test can place itself two minutes before a deadline without sleeping,
 * and daylight-saving behaviour can be checked by travelling to a transition date.
 *
 * This file is the ONLY place permitted to call `new Date()` or `Date.now()`. An ESLint
 * rule enforces that; if you find yourself wanting the current time elsewhere, take it as
 * an argument instead.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * A clock frozen at a chosen instant, optionally advanced by hand. Used by tests that
 * need to sit just before or just after a deadline.
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string) {
    this.current = typeof start === 'string' ? new Date(start) : new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(milliseconds: number): this {
    this.current = new Date(this.current.getTime() + milliseconds);
    return this;
  }

  advanceMinutes(minutes: number): this {
    return this.advance(minutes * 60_000);
  }

  set(instant: Date | string): this {
    this.current = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());
    return this;
  }
}

/** The clock the running application uses. Swapped only in tests. */
export const clock: Clock = systemClock;
