import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  ErrorCode,
  messageForErrorCode,
  statusForErrorCode,
  type ApiErrorDetail,
} from '@booking/shared';
import { AppError, databaseErrorInfo, isAppError, PG_ERROR } from '../lib/errors.js';
import { fail } from '../lib/http.js';
import { isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';

/** Terminal 404 for unmatched routes, so the client still receives the standard envelope. */
export function notFoundHandler(req: Request, res: Response): void {
  fail(
    res,
    404,
    ErrorCode.NOT_FOUND,
    `No route matches ${req.method} ${req.path}`,
    undefined,
    req.requestId,
  );
}

function zodDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * The single exit point for every failure in the API.
 *
 * Two rules govern it. First, a customer never sees an internal message: anything that is
 * not a deliberate AppError is reported as a generic 500 and the real detail goes to the
 * logs. Second, database errors that carry business meaning are translated rather than
 * leaked — most importantly SQLSTATE 23P01, the exclusion-constraint violation, which is
 * how PostgreSQL tells us another booking claimed the slot microseconds earlier. That
 * becomes a clean 409 SLOT_UNAVAILABLE, not a 500.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // Required for Express to recognise this as an error handler.
  _next: NextFunction,
): void {
  const requestId = req.requestId;

  if (error instanceof ZodError) {
    logger.debug({ requestId, issues: error.issues }, 'Request validation failed');
    fail(
      res,
      400,
      ErrorCode.VALIDATION_ERROR,
      messageForErrorCode(ErrorCode.VALIDATION_ERROR),
      zodDetails(error),
      requestId,
    );
    return;
  }

  if (isAppError(error)) {
    const level = error.status >= 500 ? 'error' : 'warn';
    logger[level](
      { requestId, code: error.code, context: error.context, err: error },
      'Request failed',
    );
    fail(res, error.status, error.code, error.message, error.details, requestId);
    return;
  }

  const db = databaseErrorInfo(error);
  if (db?.code) {
    const translated = translateDatabaseError(db.code, db.constraint);
    if (translated) {
      logger.warn(
        { requestId, sqlstate: db.code, constraint: db.constraint },
        'Database constraint translated to business error',
      );
      fail(res, translated.status, translated.code, translated.message, undefined, requestId);
      return;
    }
  }

  logger.error({ requestId, err: error }, 'Unhandled error');
  fail(
    res,
    500,
    ErrorCode.INTERNAL_ERROR,
    isProduction
      ? messageForErrorCode(ErrorCode.INTERNAL_ERROR)
      : `${messageForErrorCode(ErrorCode.INTERNAL_ERROR)} (${String(
          error instanceof Error ? error.message : error,
        )})`,
    undefined,
    requestId,
  );
}

function translateDatabaseError(
  sqlstate: string,
  constraint?: string,
): { status: number; code: ErrorCode; message: string } | null {
  switch (sqlstate) {
    case PG_ERROR.EXCLUSION_VIOLATION:
      // The appointment overlap guard. This is the race we designed for.
      return {
        status: statusForErrorCode(ErrorCode.SLOT_UNAVAILABLE),
        code: ErrorCode.SLOT_UNAVAILABLE,
        message: messageForErrorCode(ErrorCode.SLOT_UNAVAILABLE),
      };

    case PG_ERROR.UNIQUE_VIOLATION:
      return {
        status: statusForErrorCode(ErrorCode.DUPLICATE_RESOURCE),
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: constraint?.includes('email')
          ? 'That email address is already registered.'
          : messageForErrorCode(ErrorCode.DUPLICATE_RESOURCE),
      };

    case PG_ERROR.DEADLOCK_DETECTED:
    case PG_ERROR.SERIALIZATION_FAILURE:
      return {
        status: statusForErrorCode(ErrorCode.CONCURRENT_MODIFICATION),
        code: ErrorCode.CONCURRENT_MODIFICATION,
        message: messageForErrorCode(ErrorCode.CONCURRENT_MODIFICATION),
      };

    default:
      return null;
  }
}

/** Escape hatch for code paths that want the translation without going through Express. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const db = databaseErrorInfo(error);
  if (db?.code === PG_ERROR.EXCLUSION_VIOLATION) {
    return new AppError(ErrorCode.SLOT_UNAVAILABLE);
  }
  return new AppError(ErrorCode.INTERNAL_ERROR, undefined, { cause: error });
}
