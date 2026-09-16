import { z } from 'zod';
import { BookingQuestionType, LocationType, PaymentMode, TimeOffType } from '../enums/domain.js';
import {
  currencySchema,
  emailSchema,
  enumOf,
  minuteOfDaySchema,
  moneyMinorSchema,
  phoneSchema,
  slugSchema,
  timezoneSchema,
  uuidSchema,
} from './common.js';
import { passwordSchema } from './auth.js';

/* ── Services ─────────────────────────────────────────────────────────────── */

/**
 * The booking rules a service carries are the direct inputs to the slot engine, so they
 * are validated here rather than trusted. Two constraints in particular are not cosmetic:
 * the slot interval must divide the day evenly, or the grid drifts as it crosses
 * midnight; and duration plus buffers must fit inside a day, or the service can never be
 * bookable and the engine would silently return nothing forever.
 */
const serviceFields = z.object({
  name: z.string().trim().min(2, 'Give the service a name').max(120),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),

  durationMin: z
    .number()
    .int()
    .min(5, 'Appointments must be at least 5 minutes')
    .max(600, 'That is longer than a working day'),
  bufferBeforeMin: z.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.number().int().min(0).max(240).default(0),
  slotIntervalMin: z
    .number()
    .int()
    .min(5)
    .max(240)
    .refine((value) => 1440 % value === 0, 'Must divide 24 hours evenly, e.g. 10, 15, 20, 30, 60'),

  priceMinor: moneyMinorSchema.default(0),
  currency: currencySchema.default('INR'),
  paymentMode: enumOf(PaymentMode).default(PaymentMode.FREE),

  locationType: enumOf(LocationType).default(LocationType.IN_PERSON),
  locationDetail: z.string().trim().max(300).optional().nullable(),

  minNoticeMin: z.number().int().min(0).max(43_200).default(120),
  maxAdvanceDays: z.number().int().min(1).max(365).default(30),
  maxPerDay: z.number().int().min(1).max(100).optional().nullable(),
  maxPerCustomerPerDay: z.number().int().min(1).max(20).default(1),

  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4f2fe0')
    .optional()
    .nullable(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  cancellationPolicyId: uuidSchema.optional().nullable(),
  providerIds: z.array(uuidSchema).max(50).default([]),
});

/**
 * Zod 4 refuses `.partial()` on a schema that already carries a refinement, so the
 * refinement is applied to each variant rather than to a shared parent. The partial
 * variant has to tolerate absent fields: a PATCH that only changes the price must not be
 * rejected for failing to restate the duration.
 */
const withinADay = (value: {
  durationMin?: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
}): boolean =>
  (value.durationMin ?? 0) + (value.bufferBeforeMin ?? 0) + (value.bufferAfterMin ?? 0) <= 1440;

const DAY_LIMIT_MESSAGE = {
  message: 'Duration plus buffers cannot exceed 24 hours',
  path: ['durationMin'],
};

export const serviceWriteSchema = serviceFields.refine(withinADay, DAY_LIMIT_MESSAGE);

export const serviceUpdateSchema = serviceFields.partial().refine(withinADay, DAY_LIMIT_MESSAGE);

export type ServiceWriteInput = z.infer<typeof serviceWriteSchema>;

/* ── Providers ────────────────────────────────────────────────────────────── */

/**
 * Creating a provider creates the person too — a User with the PROVIDER role alongside the
 * Provider profile. Keeping those in one request avoids the half-created state where a
 * profile exists that nobody can sign in to.
 */
export const providerCreateSchema = z.object({
  name: z.string().trim().min(2, 'Give the provider a name').max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional().nullable(),
  slug: slugSchema.optional(),
  title: z.string().trim().max(120).optional().nullable(),
  bio: z.string().trim().max(2000).optional().nullable(),
  timezone: timezoneSchema.default('Asia/Kolkata'),
  serviceIds: z.array(uuidSchema).max(50).default([]),
});

export const providerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional().nullable(),
  title: z.string().trim().max(120).optional().nullable(),
  bio: z.string().trim().max(2000).optional().nullable(),
  timezone: timezoneSchema.optional(),
  isActive: z.boolean().optional(),
  serviceIds: z.array(uuidSchema).max(50).optional(),
});

export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;

/* ── Staff ────────────────────────────────────────────────────────────────── */

/**
 * Admin accounts are created by an existing admin, never by self-registration — which is
 * why the public register endpoint hard-codes CUSTOMER. Privilege has to be granted by
 * someone who already has it.
 */
export const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional().nullable(),
  timezone: timezoneSchema.default('Asia/Kolkata'),
  role: z.enum(['ADMIN', 'PROVIDER']),
});

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

/* ── Booking questions ────────────────────────────────────────────────────── */

export const bookingQuestionSchema = z
  .object({
    label: z.string().trim().min(2).max(200),
    helpText: z.string().trim().max(300).optional().nullable(),
    type: enumOf(BookingQuestionType).default(BookingQuestionType.TEXT),
    isRequired: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    sortOrder: z.number().int().min(0).max(99).default(0),
    isActive: z.boolean().default(true),
  })
  .refine(
    (value) =>
      (value.type !== BookingQuestionType.SELECT &&
        value.type !== BookingQuestionType.MULTISELECT) ||
      value.options.length >= 2,
    { message: 'A choice question needs at least two options', path: ['options'] },
  );

/* ── Time off & holidays ──────────────────────────────────────────────────── */

export const timeOffSchema = z.object({
  type: enumOf(TimeOffType).default(TimeOffType.BLOCKED),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  isAllDay: z.boolean().default(false),
  reason: z.string().trim().max(500).optional().nullable(),
});

export const holidaySchema = z.object({
  name: z.string().trim().min(2).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-MM-dd'),
});

/* ── Availability ─────────────────────────────────────────────────────────── */

export const weeklyRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: minuteOfDaySchema,
        endMinute: minuteOfDaySchema,
      }),
    )
    .max(50)
    .refine(
      (rules) => rules.every((rule) => rule.endMinute > rule.startMinute),
      'Each window must end after it starts',
    ),
});
