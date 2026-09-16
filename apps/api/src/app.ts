import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { corsOrigins, env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { databaseHealthy } from './lib/prisma.js';
import { isRedisEnabled, redisHealthy } from './lib/redis.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { ok } from './lib/http.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { apiRouter } from './modules/api.routes.js';
import { adminRouter } from './modules/admin.routes.js';

export function createApp(): Application {
  const app = express();

  // Behind a reverse proxy in production, so req.ip reflects the real client and the
  // rate limiter cannot be defeated by everyone appearing to share the proxy address.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as Request).requestId,
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        autoLogging: {
          ignore: (req) => req.url === '/health' || req.url === '/ready',
        },
      }),
    );
  }

  app.use(
    helmet({
      // The API serves JSON only; a restrictive default CSP is harmless and correct here.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: corsOrigins,
      // Required: auth travels in httpOnly cookies, not headers.
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  app.use(compression());
  // A booking payload is small; a low cap removes a trivially cheap denial-of-service.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use(cookieParser());

  // Liveness: is the process up. Deliberately free of dependency checks so a database
  // blip does not cause an orchestrator to kill an otherwise healthy process.
  app.get('/health', (_req: Request, res: Response) => {
    ok(res, { status: 'ok', uptime: Math.round(process.uptime()), version: '1.0.0' });
  });

  // Readiness: should this instance receive traffic. Redis being down is reported but
  // does not make the instance unready, because nothing depends on it for correctness.
  app.get('/ready', async (_req: Request, res: Response) => {
    const [database, redis] = await Promise.all([
      databaseHealthy(),
      isRedisEnabled() ? redisHealthy() : Promise.resolve(null),
    ]);

    // Only the database decides readiness. Redis is reported for visibility but is never
    // required: nothing in the booking write path reads it, so an unreachable cache must
    // not take an otherwise healthy instance out of rotation.
    const ready = database.healthy;

    res.status(ready ? 200 : 503).json({
      success: ready,
      data: {
        ready,
        checks: {
          database: database.healthy ? 'up' : 'down',
          redis: redis === null ? 'not configured' : redis ? 'up' : 'down',
        },
        ...(database.reason ? { databaseError: database.reason } : {}),
      },
    });
  });

  app.use(env.API_PREFIX, globalLimiter);
  app.use(`${env.API_PREFIX}/auth`, authRouter);
  // Admin CRUD is mounted first so its routes win where paths overlap the public ones.
  app.use(`${env.API_PREFIX}/admin`, adminRouter);
  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
