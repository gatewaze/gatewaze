import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // tsconfig.json keeps `jsx: preserve` for Next's compiler, which would leave
  // component JSX untransformed under vitest; compile it with React's
  // automatic runtime here so components can be rendered in tests.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['{app,lib,components,hooks}/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, '.'),
    },
  },
});
