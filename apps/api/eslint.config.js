import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': 'error',

      /**
       * The clock discipline, enforced rather than documented.
       *
       * Booking rules that depend on "now" — minimum notice, the advance horizon,
       * cancellation and reschedule deadlines, hold expiry — must receive the current
       * time as an argument so tests can position themselves either side of a boundary
       * without sleeping, and so daylight-saving behaviour can be exercised by travelling
       * to a transition date. Reading the clock inline quietly makes those rules
       * untestable, so it is a lint error everywhere except the clock module itself.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message:
            'Do not read the clock directly. Accept `now: Date` as a parameter, or use the Clock from lib/clock.ts.',
        },
        {
          selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message:
            'Do not read the clock directly. Accept `now: Date` as a parameter, or use the Clock from lib/clock.ts.',
        },
      ],
    },
  },
  {
    // The clock module, the composition root, and infrastructure adapters are allowed to
    // observe real time: TTLs, token expiry and shutdown timers are not booking rules.
    files: [
      'src/lib/clock.ts',
      'src/lib/holds.ts',
      'src/lib/prisma.ts',
      'src/server.ts',
      'src/modules/auth/**',
      'prisma/**',
      '**/*.test.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
