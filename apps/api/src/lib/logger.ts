import { pino, type Logger } from 'pino';
import { env, isDevelopment, isTest } from '../config/env.js';

/**
 * Structured logging with a pretty transport in development only.
 *
 * `redact` is not optional polish: request bodies flow through these logs and a booking
 * payload carries customer email and phone. Anything that looks like a credential or a
 * token is stripped before it can reach a log aggregator.
 */
export const logger: Logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.tokenHash',
      '*.manageTokenHash',
    ],
    censor: '[redacted]',
  },
  base: { service: 'booking-api' },
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service',
        },
      }
    : undefined,
});

/** Child logger for a subsystem, so log lines carry their origin. */
export function childLogger(module: string): Logger {
  return logger.child({ module });
}
