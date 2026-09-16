import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { childLogger } from './logger.js';

const log = childLogger('redis');

/**
 * Redis is optional by design.
 *
 * It backs slot holds and the rate limiter — both conveniences. The booking write path
 * never reads it, so the double-booking guarantee lives entirely in PostgreSQL and the
 * system is correct with Redis absent, offline, or lagging. When REDIS_URL is unset the
 * app quietly uses in-process equivalents.
 */
let client: Redis | null = null;
let unavailable = false;

export function getRedis(): Redis | null {
  if (unavailable || !env.REDIS_URL) return null;
  if (client) return client;

  client = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    // Give up rather than queue forever: a stalled Redis must not stall a booking.
    enableOfflineQueue: false,
    retryStrategy: (times: number) => (times > 5 ? null : Math.min(times * 200, 2000)),
  });

  client.on('error', (error: Error) => {
    log.warn({ err: error }, 'Redis error — continuing without cache');
  });
  client.on('connect', () => log.info('Redis connected'));

  return client;
}

export function isRedisEnabled(): boolean {
  return Boolean(env.REDIS_URL) && !unavailable;
}

export async function redisHealthy(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  unavailable = true;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
}
