import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectDatabase, disconnectDatabase } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs/outbox.js';

async function main(): Promise<void> {
  await connectDatabase();

  // Drains the transactional outbox, releases expired holds, auto-completes past visits.
  startBackgroundJobs();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, prefix: env.API_PREFIX },
      `API listening on http://localhost:${env.PORT}${env.API_PREFIX}`,
    );
  });

  /**
   * Graceful shutdown. In-flight requests matter here more than usual: a booking
   * transaction interrupted mid-commit is exactly the kind of thing that leaves a
   * customer with a confirmation email and no appointment.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    stopBackgroundJobs();
    server.close(async () => {
      await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
      clearTimeout(forceExit);
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start API');
  process.exit(1);
});
