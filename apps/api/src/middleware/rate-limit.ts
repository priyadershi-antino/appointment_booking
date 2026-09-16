import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { ErrorCode, messageForErrorCode } from '@booking/shared';
import { env } from '../config/env.js';
import { fail } from '../lib/http.js';

/**
 * Rate limiting is a protection measure, not a correctness one.
 *
 * It deliberately uses the in-process store rather than Redis. A shared store would only
 * matter across multiple instances, and buying that would mean the API failing to start
 * whenever Redis is briefly unreachable — trading a real availability risk for a
 * hypothetical accuracy gain. The booking guarantees live in PostgreSQL either way.
 */
function handler(req: Request, res: Response): void {
  fail(
    res,
    429,
    ErrorCode.RATE_LIMIT_EXCEEDED,
    messageForErrorCode(ErrorCode.RATE_LIMIT_EXCEEDED),
    undefined,
    req.requestId,
  );
}

function makeLimiter(overrides: Partial<Options>) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
    ...overrides,
  });
}

/** Baseline ceiling applied across the API. */
export const globalLimiter = makeLimiter({});

/**
 * Credential endpoints are attacked differently: a low ceiling keyed on the email being
 * tried as well as the IP, so a password-spray cannot be spread thinly across many
 * addresses from one host.
 *
 * `ipKeyGenerator` is used rather than raw `req.ip` because a bare IPv6 address would let
 * an attacker walk their own /64 and get a fresh budget for every request.
 */
export const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '0.0.0.0')}:${email}`;
  },
});

/** Guest booking is unauthenticated and creates real records, so it gets a tighter budget. */
export const bookingLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 12,
});
