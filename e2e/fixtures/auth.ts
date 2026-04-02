import { test as base } from '@playwright/test';

/**
 * Extended test fixture that provides authenticated admin sessions.
 *
 * Uses the Supabase GoTrue API directly to authenticate rather than
 * going through the UI login flow — this is faster and more reliable
 * for E2E tests.
 */
export const test = base.extend<{
  adminEmail: string;
  adminPassword: string;
}>({
  adminEmail: [process.env.TEST_ADMIN_EMAIL ?? 'admin@localhost', { option: true }],
  adminPassword: [process.env.TEST_ADMIN_PASSWORD ?? 'admin123', { option: true }],
});

export { expect } from '@playwright/test';
