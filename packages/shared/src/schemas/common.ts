import { z } from 'zod';

/**
 * Builds a Zod enum from one of our `as const` objects while keeping the literal
 * union type. Written the long way rather than passing the object straight to
 * `z.enum` so it behaves identically across Zod minor versions.
 */
export function enumOf<T extends Record<string, string>>(source: T) {
  const values = Object.values(source) as [T[keyof T], ...T[keyof T][]];
  return z.enum(values);
}

/** Cheap, dependency-free IANA zone check — the runtime is the authority. */
export function isValidTimezone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const uuidSchema = z.string().uuid('Must be a valid identifier');

export const timezoneSchema = z
  .string()
  .min(1, 'Timezone is required')
  .refine(isValidTimezone, 'Must be a valid IANA timezone, for example Asia/Kolkata');

/** Calendar date with no time component: `yyyy-MM-dd`. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in yyyy-MM-dd format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Must be a real calendar date');

/** An absolute instant on the wire. Always UTC ISO-8601. */
export const instantSchema = z
  .string()
  .datetime({ offset: true, message: 'Must be an ISO-8601 timestamp' });

/** Minutes from local midnight, used by weekly availability rules. 1440 = end of day. */
export const minuteOfDaySchema = z
  .number()
  .int('Must be a whole number of minutes')
  .min(0, 'Cannot be before midnight')
  .max(1440, 'Cannot be after midnight');

export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .max(255)
  .email('Must be a valid email address')
  .transform((value) => value.trim().toLowerCase());

/** Permissive on formatting, strict on content — international numbers vary wildly. */
export const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .regex(/^[+]?[\d\s().-]+$/, 'Phone number contains invalid characters');

export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export type Pagination = z.infer<typeof paginationSchema>;

/** Money is always handled in minor units (paise, cents) to keep it in integer space. */
export const moneyMinorSchema = z
  .number()
  .int('Amount must be a whole number of minor units')
  .min(0, 'Amount cannot be negative')
  .max(100_000_000, 'Amount is unrealistically large');

export const currencySchema = z
  .string()
  .length(3, 'Use a 3-letter ISO currency code')
  .transform((value) => value.toUpperCase());
