import { test, expect } from '@playwright/test';

test.describe('Portal Home Page', () => {
  test('loads the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });

  test('has navigation elements', async ({ page }) => {
    await page.goto('/');
    // The page should have at least one link or navigation element
    const links = page.locator('a');
    await expect(links.first()).toBeVisible();
  });
});

test.describe('Portal Events Page', () => {
  test('loads the events listing', async ({ page }) => {
    await page.goto('/events');
    await expect(page).toHaveTitle(/.+/);
  });
});

test.describe('Portal Health Check', () => {
  test('API health endpoint responds', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBeDefined();
  });
});
