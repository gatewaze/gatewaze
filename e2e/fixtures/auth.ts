import { test as base, type Page, type BrowserContext } from '@playwright/test';

/**
 * Extended test fixture providing two-account Playwright contexts for
 * multi-tenant tests per spec §7.4 task 4.2.
 *
 * Uses the Supabase GoTrue API to authenticate rather than going
 * through the UI login flow — faster and more reliable.
 *
 * Test data is seeded by `scripts/seed-e2e.ts` (run by CI before
 * invoking Playwright). The seed script creates two accounts, one
 * admin user per account, and one event per account titled
 * 'Account A Event' / 'Account B Event'.
 */

interface AccountFixture {
  adminEmail: string;
  adminPassword: string;
}

export const test = base.extend<{
  adminEmail: string;
  adminPassword: string;
  accountA: AccountFixture;
  accountB: AccountFixture;
  adminPageA: Page;
  adminPageB: Page;
}>({
  adminEmail: [process.env.TEST_ADMIN_EMAIL ?? 'admin@localhost', { option: true }],
  adminPassword: [process.env.TEST_ADMIN_PASSWORD ?? 'admin123', { option: true }],

  accountA: [
    {
      adminEmail: process.env.E2E_ACCOUNT_A_EMAIL ?? 'admin-a@localhost',
      adminPassword: process.env.E2E_ACCOUNT_A_PASSWORD ?? 'admin-a-pw',
    },
    { option: true },
  ],
  accountB: [
    {
      adminEmail: process.env.E2E_ACCOUNT_B_EMAIL ?? 'admin-b@localhost',
      adminPassword: process.env.E2E_ACCOUNT_B_PASSWORD ?? 'admin-b-pw',
    },
    { option: true },
  ],

  adminPageA: async ({ browser, accountA }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaApi(ctx, accountA);
    await use(page);
    await ctx.close();
  },

  adminPageB: async ({ browser, accountB }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaApi(ctx, accountB);
    await use(page);
    await ctx.close();
  },
});

async function loginViaApi(ctx: BrowserContext, acc: AccountFixture): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL ?? 'http://localhost:54321';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const res = await ctx.request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    data: { email: acc.adminEmail, password: acc.adminPassword },
  });
  if (!res.ok()) throw new Error(`Failed to login ${acc.adminEmail}: ${res.status()}`);
  const body = (await res.json()) as { access_token: string; refresh_token: string };
  // Set the Supabase auth cookie so the admin app picks it up.
  await ctx.addCookies([
    {
      name: 'sb-localhost-auth-token',
      value: encodeURIComponent(JSON.stringify(body)),
      url: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
}

export { expect } from '@playwright/test';
