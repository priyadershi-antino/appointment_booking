import bcrypt from 'bcryptjs';
import { ErrorCode, UserRole, type AuthUserDto } from '@booking/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { createRefreshToken, hashToken, signAccessToken } from './tokens.js';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

interface UserWithLinks {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  timezone: string;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  provider: { id: string } | null;
  customer: { id: string } | null;
}

export function toAuthUserDto(user: UserWithLinks): AuthUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    permissions: ROLE_PERMISSIONS[user.role] ?? [],
    providerId: user.provider?.id ?? null,
    customerId: user.customer?.id ?? null,
  };
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  timezone: true,
  phone: true,
  avatarUrl: true,
  isActive: true,
  passwordHash: true,
  provider: { select: { id: true } },
  customer: { select: { id: true } },
} as const;

export interface SessionResult {
  user: AuthUserDto;
  accessToken: string;
  refreshToken: string;
}

async function issueSession(
  user: UserWithLinks,
  context: { familyId?: string; userAgent?: string; ipAddress?: string },
): Promise<SessionResult> {
  const dto = toAuthUserDto(user);
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    providerId: dto.providerId,
    customerId: dto.customerId,
  });

  const refresh = createRefreshToken(context.familyId);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      familyId: refresh.familyId,
      expiresAt: refresh.expiresAt,
      userAgent: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
    },
  });

  return { user: dto, accessToken, refreshToken: refresh.token };
}

export async function login(
  email: string,
  password: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<SessionResult> {
  const user = await prisma.user.findUnique({ where: { email }, select: userSelect });

  // Compare against a dummy hash when the user does not exist so that response timing
  // does not reveal which addresses are registered.
  const hash = user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const matches = await verifyPassword(password, hash);

  if (!user || !matches) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS);
  }
  if (!user.isActive) {
    throw new AppError(ErrorCode.ACCOUNT_DISABLED);
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueSession(user, context);
}

export async function register(
  input: { name: string; email: string; password: string; phone?: string; timezone?: string },
  context: { userAgent?: string; ipAddress?: string },
): Promise<SessionResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(ErrorCode.DUPLICATE_RESOURCE, 'That email address is already registered.');
  }

  // Self-registration always produces a CUSTOMER. Staff accounts are created by an admin,
  // so no request payload can ever escalate itself to a privileged role.
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: UserRole.CUSTOMER,
      phone: input.phone ?? null,
      timezone: input.timezone ?? 'Asia/Kolkata',
      customer: {
        create: {
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          timezone: input.timezone ?? 'Asia/Kolkata',
        },
      },
    },
    select: userSelect,
  });

  return issueSession(user, context);
}

/**
 * Refresh-token rotation with reuse detection.
 *
 * Each refresh consumes its token and issues a new one in the same family. If a token
 * that was already rotated is presented again, the only sensible explanation is that it
 * was captured, so the entire family is revoked and the session ends everywhere.
 */
export async function refreshSession(
  presentedToken: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<SessionResult> {
  const tokenHash = hashToken(presentedToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: userSelect } },
  });

  if (!stored) throw new AppError(ErrorCode.TOKEN_INVALID);

  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(ErrorCode.TOKEN_INVALID, 'Your session has been ended for security reasons.');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new AppError(ErrorCode.TOKEN_EXPIRED);
  }
  if (!stored.user.isActive) {
    throw new AppError(ErrorCode.ACCOUNT_DISABLED);
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueSession(stored.user, { ...context, familyId: stored.familyId });
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presentedToken) },
  });
  if (!stored) return;
  // Revoke the whole family so signing out ends the session on this device properly.
  await prisma.refreshToken.updateMany({
    where: { familyId: stored.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function currentUser(userId: string): Promise<AuthUserDto> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!user || !user.isActive) throw new AppError(ErrorCode.UNAUTHENTICATED);
  return toAuthUserDto(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED);

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Your current password is incorrect.');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    // Changing a password ends every other session.
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
