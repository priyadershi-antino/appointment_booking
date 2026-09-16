import { Router, type Request, type Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  ErrorCode,
} from '@booking/shared';
import { validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rate-limit.js';
import { ok, created } from '../../lib/http.js';
import { AppError } from '../../lib/errors.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './tokens.js';
import * as authService from './auth.service.js';

export const authRouter = Router();

function requestContextOf(req: Request) {
  return {
    userAgent: req.header('user-agent') ?? undefined,
    ipAddress: req.ip ?? undefined,
  };
}

authRouter.post(
  '/register',
  authLimiter,
  validateBody(registerSchema),
  async (req: Request, res: Response) => {
    const session = await authService.register(req.body, requestContextOf(req));
    setAuthCookies(res, session.accessToken, session.refreshToken);
    created(res, { user: session.user }, 'Account created');
  },
);

authRouter.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const session = await authService.login(email, password, requestContextOf(req));
    setAuthCookies(res, session.accessToken, session.refreshToken);
    ok(res, { user: session.user }, 'Signed in');
  },
);

/**
 * Rotation endpoint. The refresh token is read from the cookie rather than the body so a
 * cross-site script cannot hand it over even if it can trigger the request.
 */
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (typeof presented !== 'string' || presented.length === 0) {
    throw new AppError(ErrorCode.UNAUTHENTICATED);
  }
  const session = await authService.refreshSession(presented, requestContextOf(req));
  setAuthCookies(res, session.accessToken, session.refreshToken);
  ok(res, { user: session.user }, 'Session refreshed');
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  ok(res, { loggedOut: true }, 'Signed out');
});

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await authService.currentUser(req.user!.id);
  ok(res, { user });
});

authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  async (req: Request, res: Response) => {
    await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    clearAuthCookies(res);
    ok(res, { changed: true }, 'Password updated. Please sign in again.');
  },
);
