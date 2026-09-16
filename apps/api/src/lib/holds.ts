import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { getRedis } from './redis.js';

/**
 * Slot holds — a UX affordance, not a correctness mechanism.
 *
 * When a customer picks a time, we hold it for a few minutes so the slot does not vanish
 * while they fill in their details, and the UI can show a countdown. A hold is advisory:
 * the booking write path NEVER consults it. If the hold store is empty, stale, or
 * entirely absent, bookings still behave correctly, because the real guarantee is the
 * PostgreSQL exclusion constraint.
 *
 * Holding this line matters. The moment the write path starts trusting a hold, the
 * system inherits Redis availability as a correctness dependency.
 */
export interface SlotHold {
  id: string;
  providerId: string;
  startUtc: string;
  expiresAt: Date;
}

export interface HoldStore {
  /** Returns null when the slot is already held by someone else. */
  acquire(providerId: string, startUtc: string, ttlSeconds: number): Promise<SlotHold | null>;
  release(holdId: string): Promise<void>;
  isHeld(providerId: string, startUtc: string): Promise<boolean>;
}

const holdKey = (providerId: string, startUtc: string) => `hold:${providerId}:${startUtc}`;

class RedisHoldStore implements HoldStore {
  constructor(private readonly redis: NonNullable<ReturnType<typeof getRedis>>) {}

  async acquire(
    providerId: string,
    startUtc: string,
    ttlSeconds: number,
  ): Promise<SlotHold | null> {
    const id = randomUUID();
    try {
      // NX makes this a genuine test-and-set; a losing caller simply gets null.
      const result = await this.redis.set(holdKey(providerId, startUtc), id, 'EX', ttlSeconds, 'NX');
      if (result !== 'OK') return null;
      await this.redis.set(`holdref:${id}`, holdKey(providerId, startUtc), 'EX', ttlSeconds);
      return { id, providerId, startUtc, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
    } catch {
      // Redis is down. Holds are optional, so degrade to "everything is free".
      return { id, providerId, startUtc, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
    }
  }

  async release(holdId: string): Promise<void> {
    try {
      const key = await this.redis.get(`holdref:${holdId}`);
      if (key) {
        // Only clear the slot if this hold still owns it, so a late release cannot
        // stomp on a hold someone else acquired after ours expired.
        const owner = await this.redis.get(key);
        if (owner === holdId) await this.redis.del(key);
      }
      await this.redis.del(`holdref:${holdId}`);
    } catch {
      // Nothing to do — the TTL will clean up.
    }
  }

  async isHeld(providerId: string, startUtc: string): Promise<boolean> {
    try {
      return (await this.redis.exists(holdKey(providerId, startUtc))) === 1;
    } catch {
      return false;
    }
  }
}

/**
 * In-process equivalent used when Redis is not configured. Single-instance only, which is
 * fine precisely because holds are advisory.
 */
class MemoryHoldStore implements HoldStore {
  private readonly bySlot = new Map<string, { id: string; expiresAt: number }>();
  private readonly byId = new Map<string, string>();

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.bySlot) {
      if (entry.expiresAt <= now) {
        this.bySlot.delete(key);
        this.byId.delete(entry.id);
      }
    }
  }

  async acquire(
    providerId: string,
    startUtc: string,
    ttlSeconds: number,
  ): Promise<SlotHold | null> {
    this.sweep();
    const key = holdKey(providerId, startUtc);
    if (this.bySlot.has(key)) return null;

    const id = randomUUID();
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.bySlot.set(key, { id, expiresAt });
    this.byId.set(id, key);
    return { id, providerId, startUtc, expiresAt: new Date(expiresAt) };
  }

  async release(holdId: string): Promise<void> {
    const key = this.byId.get(holdId);
    if (!key) return;
    const entry = this.bySlot.get(key);
    if (entry?.id === holdId) this.bySlot.delete(key);
    this.byId.delete(holdId);
  }

  async isHeld(providerId: string, startUtc: string): Promise<boolean> {
    this.sweep();
    return this.bySlot.has(holdKey(providerId, startUtc));
  }
}

let store: HoldStore | null = null;

export function getHoldStore(): HoldStore {
  if (store) return store;
  const redis = getRedis();
  store = redis ? new RedisHoldStore(redis) : new MemoryHoldStore();
  return store;
}

export const DEFAULT_HOLD_TTL_SECONDS = env.BOOKING_HOLD_TTL_SEC;

/** Test seam. */
export function resetHoldStore(): void {
  store = null;
}
