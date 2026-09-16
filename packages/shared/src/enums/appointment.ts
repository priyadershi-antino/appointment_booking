/**
 * Appointment lifecycle.
 *
 * The split between "occupying" and "freeing" statuses is load-bearing: it decides
 * whether a row reserves its slot on the provider's calendar. The same list is
 * duplicated into the PostgreSQL `EXCLUDE` constraint predicate, and a test asserts
 * the two representations match exactly — drift here would either surface slots the
 * database then rejects, or silently hide bookable ones.
 */
export const AppointmentStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  RESCHEDULED: 'RESCHEDULED',
} as const;

export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const ALL_APPOINTMENT_STATUSES = Object.values(AppointmentStatus);

/** Statuses whose appointment still reserves its buffered interval on the calendar. */
export const OCCUPYING_STATUSES = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
] as const satisfies readonly AppointmentStatus[];

/** Statuses whose appointment releases its interval back to the pool. */
export const FREEING_STATUSES = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
] as const satisfies readonly AppointmentStatus[];

export function isOccupying(status: AppointmentStatus): boolean {
  return (OCCUPYING_STATUSES as readonly AppointmentStatus[]).includes(status);
}

export function isTerminal(status: AppointmentStatus): boolean {
  return status !== AppointmentStatus.PENDING && status !== AppointmentStatus.CONFIRMED;
}

/** Who initiated a state change. Recorded on every history row. */
export const ActorType = {
  CUSTOMER: 'CUSTOMER',
  PROVIDER: 'PROVIDER',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const AppointmentAction = {
  CREATED: 'CREATED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  RESCHEDULED: 'RESCHEDULED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  EXPIRED: 'EXPIRED',
  UPDATED: 'UPDATED',
} as const;

export type AppointmentAction = (typeof AppointmentAction)[keyof typeof AppointmentAction];

export const CancellationReasonCode = {
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
  NO_LONGER_NEEDED: 'NO_LONGER_NEEDED',
  BOOKED_BY_MISTAKE: 'BOOKED_BY_MISTAKE',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  OTHER: 'OTHER',
} as const;

export type CancellationReasonCode =
  (typeof CancellationReasonCode)[keyof typeof CancellationReasonCode];
