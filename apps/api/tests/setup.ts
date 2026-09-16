import { afterAll } from 'vitest';
import { resolveTestDatabaseUrl } from './helpers/test-database-url.js';

/**
 * Test bootstrap.
 *
 * Loaded before every test file. Keeps environment configuration deterministic so tests
 * never depend on whatever happens to be in the developer .env, and — importantly —
 * leaves REDIS_URL unset by default. The whole suite must pass with Redis absent; that is
 * the standing proof that Redis is an accelerator and never a correctness dependency.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.ENABLE_BACKGROUND_JOBS = 'false';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-000000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-11111';
process.env.COOKIE_SECURE = 'false';

delete process.env.REDIS_URL;

/**
 * Rate limits are a protection measure, not behaviour under test. Left at their real
 * values, the fiftieth request in a file would start returning 429 and the failure would
 * look like a bug in whatever test happened to run last.
 */
process.env.RATE_LIMIT_MAX = '100000';

process.env.DATABASE_URL = resolveTestDatabaseUrl();

/**
 * Close the pool when a file finishes, or Vitest hangs waiting on open handles.
 * Imported dynamically: a static import would be hoisted above the assignments above,
 * and the Prisma client reads DATABASE_URL the moment it is constructed.
 */
afterAll(async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  await prisma.$disconnect();
});
