import { config as loadDotenv } from 'dotenv';

/**
 * Works out which database the suite is allowed to touch, and refuses anything else.
 *
 * Shared by the per-file setup and the one-time global setup, which run in different
 * processes and would otherwise each need their own copy of this reasoning.
 */
export function resolveTestDatabaseUrl(): string {
  loadDotenv();

  const explicit = process.env.TEST_DATABASE_URL;
  const source = explicit ?? process.env.DATABASE_URL;

  let candidate: string;
  if (explicit) {
    candidate = explicit;
  } else if (!source) {
    candidate = 'postgresql://postgres:postgres@localhost:5432/booking_test?schema=public';
  } else {
    // Same host and credentials as the developer's own database, sibling `_test` name.
    // Hard-coding credentials here would work on exactly one machine.
    const url = new URL(source);
    const name = url.pathname.replace(/^\//, '');
    url.pathname = `/${name.endsWith('_test') ? name : `${name.replace(/_dev$/, '')}_test`}`;
    candidate = url.toString();
  }

  /**
   * The suite truncates every table. Running that against a development or production
   * database would destroy real data, and the mistake is one stray environment variable
   * away — so refuse outright unless the name says `_test`.
   */
  const name = new URL(candidate).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${name}" — the test database name must end in "_test". ` +
        'Set TEST_DATABASE_URL to point somewhere safe.',
    );
  }

  return candidate;
}
