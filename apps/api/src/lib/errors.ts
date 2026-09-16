import {
  ErrorCode,
  messageForErrorCode,
  statusForErrorCode,
  type ApiErrorDetail,
} from '@booking/shared';

/**
 * The only error type the API deliberately throws.
 *
 * Anything else reaching the error middleware is treated as unexpected and reported as a
 * generic 500 — internal messages and stack traces never reach a customer.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetail[];
  /** Extra context for the logs only. Never serialised into the response. */
  readonly context?: Record<string, unknown>;
  readonly expected = true;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { details?: ApiErrorDetail[]; context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message ?? messageForErrorCode(code), { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = statusForErrorCode(code);
    this.details = options?.details;
    this.context = options?.context;
    Error.captureStackTrace?.(this, AppError);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Shorthand constructors for the codes used most often, to keep call sites readable. */
export const errors = {
  validation: (details: ApiErrorDetail[], message?: string) =>
    new AppError(ErrorCode.VALIDATION_ERROR, message, { details }),

  unauthenticated: (message?: string) => new AppError(ErrorCode.UNAUTHENTICATED, message),

  forbidden: (message?: string) => new AppError(ErrorCode.FORBIDDEN, message),

  notFound: (code: ErrorCode = ErrorCode.NOT_FOUND, message?: string) =>
    new AppError(code, message),

  /** The canonical booking conflict. Raised when the database rejects an overlap. */
  slotUnavailable: (context?: Record<string, unknown>) =>
    new AppError(ErrorCode.SLOT_UNAVAILABLE, undefined, { context }),

  businessRule: (code: ErrorCode, message?: string, context?: Record<string, unknown>) =>
    new AppError(code, message, { context }),

  internal: (message?: string, cause?: unknown) =>
    new AppError(ErrorCode.INTERNAL_ERROR, message, { cause }),
};

/**
 * PostgreSQL SQLSTATE codes we translate deliberately.
 *
 * 23P01 is the exclusion-constraint violation raised by the appointment overlap guard —
 * it is the load-bearing signal that another booking claimed the slot first, and it must
 * surface to the client as a clean 409 rather than a 500.
 */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  EXCLUSION_VIOLATION: '23P01',
  CHECK_VIOLATION: '23514',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const;

interface DatabaseErrorShape {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * Pulls the PostgreSQL SQLSTATE out of whichever error shape reached us.
 *
 * This is fiddly for a reason worth stating: Prisma does not surface the SQLSTATE at the
 * top level. A driver error arrives wrapped in a PrismaClientKnownRequestError whose own
 * `code` is a Prisma code like `P2010`, with the real SQLSTATE tucked into `meta` or, for
 * some paths, only in the rendered message. Reading `error.code` naively yields `P2010`
 * and the exclusion violation gets reported as a 500 — the booking conflict looks like a
 * server fault instead of "someone took that slot".
 */
export function databaseErrorInfo(error: unknown): DatabaseErrorShape | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as Record<string, unknown>;

  const rawCode = typeof candidate.code === 'string' ? candidate.code : undefined;
  const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : undefined;
  const message = String(candidate.message ?? '');

  // A native driver error: the SQLSTATE is already right here.
  if (rawCode && !rawCode.startsWith('P')) {
    return { code: rawCode, constraint, message };
  }

  // Prisma's own meta sometimes carries the underlying SQLSTATE.
  const meta = candidate.meta as Record<string, unknown> | undefined;
  if (meta) {
    const metaCode =
      typeof meta.code === 'string'
        ? meta.code
        : typeof meta.db_error_code === 'string'
          ? meta.db_error_code
          : undefined;
    if (metaCode && !metaCode.startsWith('P')) {
      return {
        code: metaCode,
        constraint:
          typeof meta.constraint === 'string'
            ? meta.constraint
            : constraintFromMessage(String(meta.message ?? message)),
        message: String(meta.message ?? message),
      };
    }
  }

  // Last resort: Prisma renders `Database error. Code: `23P01`.` into the message.
  const fromMessage = /Code:\s*`?([0-9A-Z]{5})`?/.exec(message);
  if (fromMessage?.[1]) {
    return {
      code: fromMessage[1],
      constraint: constraint ?? constraintFromMessage(message),
      message,
    };
  }

  if (candidate.cause) return databaseErrorInfo(candidate.cause);

  return null;
}

function constraintFromMessage(message: string): string | undefined {
  return /constraint\s+\\?"([^"\\]+)\\?"/.exec(message)?.[1];
}

export function isExclusionViolation(error: unknown): boolean {
  return databaseErrorInfo(error)?.code === PG_ERROR.EXCLUSION_VIOLATION;
}

export function isUniqueViolation(error: unknown): boolean {
  return databaseErrorInfo(error)?.code === PG_ERROR.UNIQUE_VIOLATION;
}

export function isRetryableDatabaseError(error: unknown): boolean {
  const code = databaseErrorInfo(error)?.code;
  return code === PG_ERROR.SERIALIZATION_FAILURE || code === PG_ERROR.DEADLOCK_DETECTED;
}
