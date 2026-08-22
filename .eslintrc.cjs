/* eslint-env node */
module.exports = {
  root: true,
  env: { es2023: true, node: true, browser: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: { alwaysTryTypes: true, project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
    },
    react: { version: 'detect' },
  },
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-unresolved': 'off',
    // Noisy on libraries whose default export shares a name with a named one
    // (i18next, zustand). The warning has never caught a real bug here.
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    // CommonJS packages (bcryptjs, jsonwebtoken, nodemailer, prom-client) do
    // provide a default under esModuleInterop, but the rule reads the ESM
    // shape and reports a false positive on every one of them.
    'import/default': 'off',
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['../../../*'],
            message: 'Use the package alias (@/…) instead of deep relative imports.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['apps/web/**/*.tsx', 'apps/admin/**/*.tsx'],
      plugins: ['react', 'react-hooks'],
      extends: ['plugin:react/recommended', 'plugin:react/jsx-runtime', 'plugin:react-hooks/recommended'],
      rules: {
        // TypeScript props are the contract; runtime prop-types would be a
        // second, weaker copy of it that drifts.
        'react/prop-types': 'off',
        // forwardRef components get their name from the assignment, which the
        // rule cannot see.
        'react/display-name': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**'],
      env: { node: true },
      rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
    },
    {
      files: ['**/*.cjs', '**/*.config.ts', '**/*.config.js', 'apps/server/src/scripts/**'],
      rules: { 'no-console': 'off' },
    },
  ],
  ignorePatterns: [
    'dist',
    'build',
    'node_modules',
    'coverage',
    'apps/mobile/**',
    'infra/**',
    '**/*.d.ts',
  ],
};
