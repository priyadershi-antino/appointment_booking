import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Environment contract.
 *
 * The process refuses to start on an invalid or missing variable rather than failing
 * later with a confusing runtime error. Secrets have no defaults — a missing JWT secret
 * in production must be loud, never silently substituted.
 */
const booleanish = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PREFIX: z.string().default('/api/v1'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    /**
     * Optional throughout. Redis accelerates slot holds and backs the rate limiter, but
     * the booking write path never reads it — correctness lives in PostgreSQL. With this
     * unset the app falls back to in-process implementations and behaves identically.
     */
    REDIS_URL: z.string().optional(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    COOKIE_SECURE: booleanish.default(false),
    COOKIE_DOMAIN: z.string().optional(),
    /**
     * Must be `none` when the web client is served from a different origin to the API,
     * which is the normal case on hosted deployments (api.example.com vs app.example.com).
     * Browsers drop a `strict` or `lax` cookie on a cross-site XHR, so login would appear
     * to succeed and then every subsequent request would be unauthenticated.
     * `none` additionally requires COOKIE_SECURE=true.
     */
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),

    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    /** Comma-separated list; falls back to FRONTEND_URL when unset. */
    CORS_ORIGINS: z.string().optional(),

    // `silent` is a real pino level and is what the test bootstrap sets; leaving it out
    // of this enum made the whole suite exit 1 before a single test file could load.
    LOG_LEVEL: z
      .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),

    /**
     * console — print to the log (default; zero setup, nothing leaves the machine)
     * file    — write .eml files you can open
     * smtp    — deliver for real through any SMTP server
     * ethereal — deliver to a throwaway inbox and log a preview URL. Needs no account
     *           and no credentials, which makes it the honest way to demonstrate that
     *           mail actually sends without asking anyone for a password.
     */
    EMAIL_PROVIDER: z.enum(['console', 'file', 'smtp', 'ethereal']).default('console'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** True for port 465 (implicit TLS); false for 587 with STARTTLS. */
    SMTP_SECURE: booleanish.default(false),
    EMAIL_FROM: z.string().default('Bookings <no-reply@example.com>'),
    /** Where the `file` email provider writes .eml files during development. */
    MAIL_OUTPUT_DIR: z.string().default('./tmp/mail'),

    /** How long a slot hold survives while the customer fills in the booking form. */
    BOOKING_HOLD_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(600),
    /** Grace period before a PENDING appointment past its hold is swept away. */
    PENDING_SWEEP_GRACE_SEC: z.coerce.number().int().min(0).default(120),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
    /** Set false to run the API without its background pollers, e.g. in tests. */
    ENABLE_BACKGROUND_JOBS: booleanish.default(true),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }
    if (value.COOKIE_SAMESITE === 'none' && !value.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SAMESITE'],
        message: 'COOKIE_SAMESITE=none requires COOKIE_SECURE=true',
      });
    }
    if (value.EMAIL_PROVIDER === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_PROVIDER=smtp',
      });
    }
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must differ',
      });
    }
  });

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Written straight to stderr: the logger itself depends on this config.
    process.stderr.write(`\nInvalid environment configuration:\n${problems}\n\n`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

export const corsOrigins = (env.CORS_ORIGINS ?? env.FRONTEND_URL)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export type Env = typeof env;
