import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moved the connection URL out of schema.prisma. This file configures the CLI
 * (migrate, studio, seed); the runtime client gets its connection through the pg driver
 * adapter in src/lib/prisma.ts instead.
 *
 * DIRECT_DATABASE_URL exists for pooled providers. Supabase, Neon and friends put
 * pgBouncer in front of Postgres, and in transaction-pooling mode it does not support
 * the prepared statements and session state that DDL relies on — so `migrate deploy`
 * fails there in ways that read as random. Point DATABASE_URL at the pooler for normal
 * traffic and DIRECT_DATABASE_URL at the direct/session connection for migrations.
 * With only DATABASE_URL set, both use it, which is right for a plain Postgres server.
 */
const migrationUrl = process.env.DIRECT_DATABASE_URL
  ? env('DIRECT_DATABASE_URL')
  : env('DATABASE_URL');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: migrationUrl,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
