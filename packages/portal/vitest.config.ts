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
    alias: [
      { find: '@', replacement: path.join(__dirname, '.') },
      // Same mapping as tsconfig paths (portal has no package dependency on it).
      { find: '@gatewaze/shared', replacement: path.resolve(__dirname, '../shared/src') },
      // Source, not dist (dist is not built in a test run). Subpaths first.
      { find: /^@gatewaze\/tracking\/(client|server)$/, replacement: path.resolve(__dirname, '../tracking/src/$1/index.ts') },
      { find: /^@gatewaze\/tracking$/, replacement: path.resolve(__dirname, '../tracking/src/index.ts') },
    ],
  },
});
