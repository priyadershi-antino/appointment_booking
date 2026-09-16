import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { type UserRole } from '@booking/shared';
import { env } from '../../config/env.js';

export const ACCESS_COOKIE = 'booking_access';
export const REFRESH_COOKIE = 'booking_refresh';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  providerId: string | null;
  customerId: string | null;
}

export interface RefreshTokenPayload {
  sub: string;
  /** Token family, so reuse of a rotated token can revoke the whole lineage. */
  fid: string;
  jti: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: 'booking-api',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'booking-api',
  }) as AccessTokenPayload & jwt.JwtPayload;
}

/**
 * Refresh tokens are opaque random strings, not JWTs.
 *
 * Only their SHA-256 hash is stored, so a database leak does not hand out sessions, and
 * each one belongs to a family: presenting an already-rotated token is treated as theft
 * and revokes every token in that family.
 */
export function createRefreshToken(familyId: string = randomUUID()): {
  token: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
} {
  const token = randomBytes(48).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    familyId,
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    // Configurable because it depends on deployment shape, not on environment name:
    // same-origin deployments want `lax`, split api/web domains require `none`.
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: 15 * 60 * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  const options = baseCookieOptions();
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}
