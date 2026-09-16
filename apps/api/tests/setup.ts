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

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/booking_test?schema=public';
