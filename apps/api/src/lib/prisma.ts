import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env, isDevelopment } from '../config/env.js';
import { logger } from './logger.js';
import { describeDatabaseError } from './db-error.js';

/**
 * The pg driver adapter is a deliberate choice, not a default.
 *
 * It lets the original PostgreSQL error reach us intact — SQLSTATE `code` and the
 * violated `constraint` name survive on the thrown object. The booking write path
 * depends on recognising `23P01` (exclusion violation) to return a clean 409 instead of
 * a generic 500, and that recognition is only possible because the driver error is not
 * flattened into a string.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

function createClient(): PrismaClient {
  const client = new PrismaClient({
    adapter,
    log: isDevelopment
      ? [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
  });

  client.$on('error', (event) => logger.error({ prisma: event }, 'Prisma error'));
  if (isDevelopment) {
    client.$on('warn', (event) => logger.warn({ prisma: event }, 'Prisma warning'));
  }

  return client;
}

/**
 * Reused across hot reloads in development, otherwise `tsx watch` would open a new pool
 * on every file save until PostgreSQL refuses connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (isDevelopment) {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (error) {
    logger.fatal({ reason: describeDatabaseError(error) }, 'Could not connect to the database');
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/** Cheap liveness probe used by the readiness endpoint. */
export interface DatabaseHealth {
  healthy: boolean;
  /** Safe to show an operator: the failure reason with any password stripped. */
  reason?: string;
}

/**
 * Liveness probe for the database.
 *
 * Returns WHY it failed, not just that it did. A readiness endpoint that says only
 * "down" turns a five-second fix — wrong host, missing sslmode, unreachable pooler —
 * into an afternoon of guessing, because the deployment logs are the only other clue
 * and they are behind someone else's dashboard.
 */
export async function databaseHealthy(): Promise<DatabaseHealth> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true };
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return { healthy: false, reason: describeDatabaseError(error) };
  }
}

export type { PrismaClient };

/**
 * The type of the client handed to a `$transaction` callback. Services that must run
 * inside an existing transaction accept this rather than the full client, which makes it
 * impossible to accidentally escape the transaction.
 */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
