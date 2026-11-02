// Flat config mirroring packages/api's shape: TS-only, no React plugins
// wired yet (react-hooks can join once the ecosystem plugin set is settled
// for RN in this workspace).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['src/generated/**', '.expo/**', 'ios/**', 'android/**'],
  },
  {
    // Build/release scripts are Node programs, not React Native code.
    files: ['scripts/**'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', __dirname: 'readonly', fetch: 'readonly', setTimeout: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  }
);
