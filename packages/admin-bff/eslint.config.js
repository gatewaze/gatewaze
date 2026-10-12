import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Flat config for @gatewaze/admin-bff, a server-side Node package. Mirrors
// packages/api/eslint.config.js (eslint v9, typescript-eslint recommended),
// with explicit-any kept as an error since this package has no reason for it.
// No globals list: typescript-eslint's recommended set turns off no-undef for
// .ts files, since the compiler already checks for undefined names.
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
