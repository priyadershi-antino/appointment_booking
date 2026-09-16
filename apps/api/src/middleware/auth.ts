import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ErrorCode, UserRole } from '@booking/shared';
import { AppError } from '../lib/errors.js';
import { ROLE_PERMISSIONS, type Permission } from '../config/permissions.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../modules/auth/tokens.js';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  providerId: string | null;
  customerId: string | null;
  permissions: Set<Permission>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function extractToken(req: Request): string | null {
  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof cookie === 'string' && cookie.length > 0) return cookie;

  // Bearer tokens are accepted so the API stays usable from curl and tests.
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();

  return null;
}

function toAuthenticatedUser(payload: {
  sub: string;
  role: UserRole;
  providerId: string | null;
  customerId: string | null;
}): AuthenticatedUser {
  return {
    id: payload.sub,
    role: payload.role,
    providerId: payload.providerId,
    customerId: payload.customerId,
    permissions: new Set(ROLE_PERMISSIONS[payload.role] ?? []),
  };
}

/** Populates `req.user` when a valid token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next();
  try {
    req.user = toAuthenticatedUser(verifyAccessToken(token));
  } catch {
    // An expired or malformed token on a public route is simply an anonymous visitor.
  }
  next();
}

/** Requires a valid session. Distinguishes "expired" from "invalid" so the client knows to refresh. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next(new AppError(ErrorCode.UNAUTHENTICATED));

  try {
    req.user = toAuthenticatedUser(verifyAccessToken(token));
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError(ErrorCode.TOKEN_EXPIRED));
    }
    next(new AppError(ErrorCode.TOKEN_INVALID));
  }
}

/**
 * Capability gate. Hiding a button in the UI is presentation; this is the actual control,
 * and every mutating route carries one.
 */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) return next(new AppError(ErrorCode.UNAUTHENTICATED));

    const missing = required.filter((permission) => !user.permissions.has(permission));
    if (missing.length > 0) {
      return next(
        new AppError(ErrorCode.INSUFFICIENT_PERMISSIONS, undefined, {
          context: { required, missing, role: user.role },
        }),
      );
    }
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) return next(new AppError(ErrorCode.UNAUTHENTICATED));
    if (!roles.includes(user.role)) return next(new AppError(ErrorCode.FORBIDDEN));
    next();
  };
}

/** Throws unless the request is from an admin — used by services doing ownership checks. */
export function assertOwnershipOrAdmin(
  user: AuthenticatedUser,
  ownerIds: { providerId?: string | null; customerId?: string | null },
): void {
  if (user.role === UserRole.ADMIN) return;

  const ownsAsProvider =
    user.providerId != null && ownerIds.providerId != null && user.providerId === ownerIds.providerId;
  const ownsAsCustomer =
    user.customerId != null && ownerIds.customerId != null && user.customerId === ownerIds.customerId;

  if (!ownsAsProvider && !ownsAsCustomer) {
    throw new AppError(ErrorCode.FORBIDDEN);
  }
}
