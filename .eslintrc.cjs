module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // 'prettier' was here but eslint-config-prettier isn't installed —
    // dropping it lets `next lint` (which auto-discovers this file) run
    // instead of failing at config-load time. Format-vs-lint conflicts
    // haven't materialised because we don't run prettier in CI.
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  rules: {
    // varsIgnorePattern matches admin's flat config — silences the
    // common `const { trackingHead: _, trackingBody: __, ...rest } = ...`
    // destructure pattern that's idiomatic for stripping server-only
    // fields before forwarding to client components.
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  ignorePatterns: ['dist', 'node_modules', '.next'],
};
