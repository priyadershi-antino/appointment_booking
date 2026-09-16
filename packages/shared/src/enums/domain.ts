export const UserRole = {
  ADMIN: 'ADMIN',
  PROVIDER: 'PROVIDER',
  CUSTOMER: 'CUSTOMER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const LocationType = {
  IN_PERSON: 'IN_PERSON',
  ONLINE: 'ONLINE',
  PHONE: 'PHONE',
} as const;
export type LocationType = (typeof LocationType)[keyof typeof LocationType];

/**
 * How a service is paid for. Payment processing itself is out of scope for this
 * version — what the booking engine actually cares about is whether a new booking
 * lands on CONFIRMED immediately (FREE) or waits at PENDING for approval.
 */
export const PaymentMode = {
  FREE: 'FREE',
  PAY_AT_BOOKING: 'PAY_AT_BOOKING',
  PAY_LATER: 'PAY_LATER',
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const TimeOffType = {
  VACATION: 'VACATION',
  SICK_LEAVE: 'SICK_LEAVE',
  PERSONAL: 'PERSONAL',
  HOLIDAY: 'HOLIDAY',
  BLOCKED: 'BLOCKED',
} as const;
export type TimeOffType = (typeof TimeOffType)[keyof typeof TimeOffType];

/** An override either closes the day outright or replaces its windows wholesale. */
export const OverrideType = {
  UNAVAILABLE: 'UNAVAILABLE',
  CUSTOM_HOURS: 'CUSTOM_HOURS',
} as const;
export type OverrideType = (typeof OverrideType)[keyof typeof OverrideType];

export const BookingQuestionType = {
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  SELECT: 'SELECT',
  MULTISELECT: 'MULTISELECT',
  CHECKBOX: 'CHECKBOX',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  NUMBER: 'NUMBER',
} as const;
export type BookingQuestionType = (typeof BookingQuestionType)[keyof typeof BookingQuestionType];

/** 0 = Sunday, matching JavaScript's `Date#getDay`. */
export const Weekday = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;
export type Weekday = (typeof Weekday)[keyof typeof Weekday];

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
