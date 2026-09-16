import { z } from 'zod';
import { UserRole } from '../enums/domain.js';
import { emailSchema, enumOf, phoneSchema, timezoneSchema } from './common.js';

/**
 * Password policy. Length does most of the work here; the character-class rule is
 * kept deliberately mild so it nudges rather than frustrates.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'That password is too long')
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value), 'Include upper and lower case letters')
  .refine((value) => /\d/.test(value), 'Include at least one number');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  timezone: timezoneSchema.optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'Choose a password different from your current one',
    path: ['newPassword'],
  });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  timezone: timezoneSchema.optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const userRoleSchema = enumOf(UserRole);

/** Shape returned by `/auth/me` and embedded in login responses. */
export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  timezone: string;
  phone: string | null;
  avatarUrl: string | null;
  permissions: string[];
  /** Present when the signed-in user is also a provider. */
  providerId: string | null;
  customerId: string | null;
}
