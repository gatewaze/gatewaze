import { defineConfig, devices } from '@playwright/test';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5274';
const PORTAL_URL = process.env.PORTAL_URL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'admin',
      testMatch: /admin\/.+\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN_URL,
      },
    },
    {
      name: 'portal',
      testMatch: /portal\/.+\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PORTAL_URL,
      },
    },
  ],
});
