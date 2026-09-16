/**
 * The complete catalogue of machine-readable error codes the API can return.
 *
 * Clients switch on `error.code`, never on the human message — the message is free to
 * change wording, the code is a contract. Every code maps to exactly one HTTP status
 * via ERROR_STATUS below.
 */
export const ErrorCode = {
  // 400 — the request itself is malformed
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_TIMEZONE: 'INVALID_TIMEZONE',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',

  // 401 — we do not know who you are
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // 403 — we know who you are and you may not do this
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  // 404
  NOT_FOUND: 'NOT_FOUND',
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  APPOINTMENT_NOT_FOUND: 'APPOINTMENT_NOT_FOUND',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',

  // 409 — someone else got there first
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',

  // 422 — well-formed, but it breaks a business rule
  BOOKING_NOTICE_VIOLATION: 'BOOKING_NOTICE_VIOLATION',
  BOOKING_HORIZON_VIOLATION: 'BOOKING_HORIZON_VIOLATION',
  PROVIDER_DAILY_LIMIT: 'PROVIDER_DAILY_LIMIT',
  CUSTOMER_DAILY_LIMIT: 'CUSTOMER_DAILY_LIMIT',
  INVALID_SLOT_START: 'INVALID_SLOT_START',
  OUTSIDE_AVAILABILITY: 'OUTSIDE_AVAILABILITY',
  CANCELLATION_DEADLINE_PASSED: 'CANCELLATION_DEADLINE_PASSED',
  RESCHEDULE_DEADLINE_PASSED: 'RESCHEDULE_DEADLINE_PASSED',
  CANCELLATION_NOT_ALLOWED: 'CANCELLATION_NOT_ALLOWED',
  RESCHEDULE_NOT_ALLOWED: 'RESCHEDULE_NOT_ALLOWED',
  SERVICE_INACTIVE: 'SERVICE_INACTIVE',
  PROVIDER_INACTIVE: 'PROVIDER_INACTIVE',
  PROVIDER_NOT_ASSIGNED: 'PROVIDER_NOT_ASSIGNED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  APPOINTMENT_IN_PAST: 'APPOINTMENT_IN_PAST',
  NO_PROVIDER_AVAILABLE: 'NO_PROVIDER_AVAILABLE',

  // 429
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // 500 / 503
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  INVALID_TIMEZONE: 400,
  INVALID_DATE_RANGE: 400,

  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,

  FORBIDDEN: 403,
  INSUFFICIENT_PERMISSIONS: 403,
  ACCOUNT_DISABLED: 403,

  NOT_FOUND: 404,
  SERVICE_NOT_FOUND: 404,
  PROVIDER_NOT_FOUND: 404,
  APPOINTMENT_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,

  SLOT_UNAVAILABLE: 409,
  DUPLICATE_RESOURCE: 409,
  CONCURRENT_MODIFICATION: 409,
  INVALID_STATUS_TRANSITION: 409,

  BOOKING_NOTICE_VIOLATION: 422,
  BOOKING_HORIZON_VIOLATION: 422,
  PROVIDER_DAILY_LIMIT: 422,
  CUSTOMER_DAILY_LIMIT: 422,
  INVALID_SLOT_START: 422,
  OUTSIDE_AVAILABILITY: 422,
  CANCELLATION_DEADLINE_PASSED: 422,
  RESCHEDULE_DEADLINE_PASSED: 422,
  CANCELLATION_NOT_ALLOWED: 422,
  RESCHEDULE_NOT_ALLOWED: 422,
  SERVICE_INACTIVE: 422,
  PROVIDER_INACTIVE: 422,
  PROVIDER_NOT_ASSIGNED: 422,
  PAYMENT_REQUIRED: 422,
  PAYMENT_FAILED: 422,
  APPOINTMENT_IN_PAST: 422,
  NO_PROVIDER_AVAILABLE: 422,

  RATE_LIMIT_EXCEEDED: 429,

  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Default customer-facing wording. Deliberately free of internal detail — a customer
 * seeing SLOT_UNAVAILABLE should be told to pick another time, not told about a
 * PostgreSQL exclusion constraint.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Some of the information provided is invalid.',
  BAD_REQUEST: 'The request could not be processed.',
  INVALID_TIMEZONE: 'That timezone is not recognised.',
  INVALID_DATE_RANGE: 'The date range provided is invalid.',

  UNAUTHENTICATED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_INVALID: 'Your session is no longer valid. Please sign in again.',

  FORBIDDEN: 'You do not have access to this resource.',
  INSUFFICIENT_PERMISSIONS: 'You do not have permission to perform this action.',
  ACCOUNT_DISABLED: 'This account has been deactivated.',

  NOT_FOUND: 'The requested resource could not be found.',
  SERVICE_NOT_FOUND: 'That service could not be found.',
  PROVIDER_NOT_FOUND: 'That provider could not be found.',
  APPOINTMENT_NOT_FOUND: 'That appointment could not be found.',
  CUSTOMER_NOT_FOUND: 'That customer could not be found.',

  SLOT_UNAVAILABLE: 'This time slot is no longer available. Please choose another time.',
  DUPLICATE_RESOURCE: 'That already exists.',
  CONCURRENT_MODIFICATION: 'This record was changed by someone else. Please reload and try again.',
  INVALID_STATUS_TRANSITION: 'That change is not allowed for this appointment.',

  BOOKING_NOTICE_VIOLATION: 'This time is too soon to book. Please choose a later time.',
  BOOKING_HORIZON_VIOLATION: 'This date is too far ahead to book.',
  PROVIDER_DAILY_LIMIT: 'This provider is fully booked on that day.',
  CUSTOMER_DAILY_LIMIT: 'You have reached the booking limit for that day.',
  INVALID_SLOT_START: 'That is not a valid start time for this service.',
  OUTSIDE_AVAILABILITY: 'That time falls outside the available hours.',
  CANCELLATION_DEADLINE_PASSED: 'The cancellation window for this appointment has closed.',
  RESCHEDULE_DEADLINE_PASSED: 'The rescheduling window for this appointment has closed.',
  CANCELLATION_NOT_ALLOWED: 'This appointment cannot be cancelled.',
  RESCHEDULE_NOT_ALLOWED: 'This appointment cannot be rescheduled.',
  SERVICE_INACTIVE: 'This service is not currently accepting bookings.',
  PROVIDER_INACTIVE: 'This provider is not currently accepting bookings.',
  PROVIDER_NOT_ASSIGNED: 'This provider does not offer the selected service.',
  PAYMENT_REQUIRED: 'Payment is required to confirm this booking.',
  PAYMENT_FAILED: 'The payment could not be completed.',
  APPOINTMENT_IN_PAST: 'That appointment time has already passed.',
  NO_PROVIDER_AVAILABLE: 'No provider is available at that time.',

  RATE_LIMIT_EXCEEDED: 'Too many requests. Please slow down and try again shortly.',

  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again shortly.',
};

export function statusForErrorCode(code: ErrorCode): number {
  return ERROR_STATUS[code] ?? 500;
}

export function messageForErrorCode(code: ErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
}
