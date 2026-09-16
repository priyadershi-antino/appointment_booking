import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: false,
    /**
     * Integration tests run against a real PostgreSQL, because the exclusion constraint
     * IS the double-booking guarantee — mocking Prisma here would assert nothing. Forks
     * (not threads) keep each worker with its own connection pool and its own database,
     * which is what makes the concurrency tests honest.
     */
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false },
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/domain/**', 'src/modules/**'],
      exclude: ['**/*.test.ts', 'src/generated/**'],
      thresholds: {
        // The engine carries the correctness burden, so it is held to a higher bar than
        // the CRUD surface around it.
        'src/domain/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
