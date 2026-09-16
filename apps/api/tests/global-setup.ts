import { Client } from 'pg';
import { resolveTestDatabaseUrl } from './helpers/test-database-url.js';

/**
 * Runs once, before any test file.
 *
 * Two jobs: leave the database empty so a previous run cannot influence this one, and
 * refuse to continue if the schema is missing the thing the whole system rests on.
 */
export default async function globalSetup(): Promise<void> {
  const connectionString = resolveTestDatabaseUrl();
  const client = new Client({ connectionString });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to the test database.\n` +
        `  ${(error as Error).message}\n\n` +
        `Create it and apply the schema:\n` +
        `  createdb booking_test\n` +
        `  DATABASE_URL=<test url> npx prisma migrate deploy\n`,
    );
  }

  /**
   * The exclusion constraint IS the double-booking guarantee. `prisma db push` drops it
   * silently, so a developer who reached for that command would otherwise get a green
   * suite that proves nothing. Fail loudly instead.
   */
  const guard = await client.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_overlap'`,
  );
  if (guard.rowCount === 0) {
    await client.end();
    throw new Error(
      'The test database is missing the "appointments_no_overlap" exclusion constraint.\n' +
        'Apply migrations with `prisma migrate deploy` — never `prisma db push`, which drops it.',
    );
  }

  const tables = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );

  if (tables.rowCount && tables.rowCount > 0) {
    const list = tables.rows.map((row) => `"public"."${row.tablename}"`).join(', ');
    // TRUNCATE does not fire the row-level trigger that makes appointment_history
    // append-only, which is exactly why the suite can reset it at all.
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  await client.end();
}
