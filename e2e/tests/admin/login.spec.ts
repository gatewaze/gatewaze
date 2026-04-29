import { test, expect } from '../../fixtures/auth';

/**
 * Admin login + multi-tenant create-event E2E. Replaces the prior
 * tautological version per spec PR-H-12. Each assertion has a real
 * failure mode; nothing is wrapped in a tautology like
 * `expect(... || url === page.url())`.
 *
 * Two-account scenario:
 *   - Account A admin creates an event titled 'Account A Event'.
 *   - Account B admin (different login session) lists events.
 *   - Account A's event MUST NOT appear in account B's list.
 *
 * The fixture in ../fixtures/auth.ts seeds the two test accounts +
 * users + JWT cookies; it expects an integration backend (Supabase
 * + API + admin) to be running. CI wires this up; locally, run
 * `pnpm dev` first.
 */

test.describe('Admin login', () => {
  test('redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toMatch(/\/(login|sign-in)/);
  });

  test('login form renders email + password inputs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('valid credentials redirect to dashboard', async ({ page, accountA }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(accountA.adminEmail);
    await page.locator('input[type="password"]').fill(accountA.adminPassword);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(dashboard|events)/, { timeout: 10_000 });
    expect(page.url()).not.toContain('/login');
  });
});

test.describe('Multi-tenant isolation', () => {
  test('account A admin sees only account A events', async ({ adminPageA }) => {
    await adminPageA.goto('/events');
    await adminPageA.waitForLoadState('networkidle');
    const titles = await adminPageA.locator('[data-testid="event-row-title"]').allTextContents();
    expect(titles).toContain('Account A Event');
    expect(titles).not.toContain('Account B Event');
  });

  test('account B admin sees only account B events', async ({ adminPageB }) => {
    await adminPageB.goto('/events');
    await adminPageB.waitForLoadState('networkidle');
    const titles = await adminPageB.locator('[data-testid="event-row-title"]').allTextContents();
    expect(titles).toContain('Account B Event');
    expect(titles).not.toContain('Account A Event');
  });
});
