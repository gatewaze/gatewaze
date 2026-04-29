import { test, expect } from '@playwright/test';

/**
 * Public-portal RSVP flow per spec PR-H-14 (no tests for capacity
 * limits / sub-event conditional). Exercises the invite-token →
 * accept → registration path, and the capacity-exceeded path that
 * was previously untested.
 *
 * Fixtures are seeded by the API harness scripts/seed-e2e.ts (which
 * the CI workflow runs before invoking Playwright).
 */

const TOKEN_OPEN = process.env.E2E_INVITE_TOKEN_OPEN ?? 'open-test-token';
const TOKEN_FULL = process.env.E2E_INVITE_TOKEN_FULL ?? 'full-test-token';

test.describe('RSVP — happy path', () => {
  test('invite token resolves and accept→confirmed', async ({ page, request }) => {
    await page.goto(`/rsvp/${TOKEN_OPEN}`);
    await page.waitForLoadState('networkidle');
    // Confirm the page loaded the invite (event title visible).
    const heading = page.locator('h1, [data-testid="event-title"]').first();
    await expect(heading).toBeVisible();

    // Click the accept button.
    await page.locator('[data-testid="rsvp-accept"]').click();
    // Expect a confirmed state.
    await expect(page.locator('[data-testid="rsvp-confirmed"]')).toBeVisible({ timeout: 5_000 });

    // Backend assertion: the registration API now lists this person.
    const res = await request.get(`/api/registrations?event_token=${TOKEN_OPEN}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data?.length).toBeGreaterThan(0);
  });
});

test.describe('RSVP — capacity exceeded', () => {
  test('invite token to a full event returns capacity error', async ({ page }) => {
    await page.goto(`/rsvp/${TOKEN_FULL}`);
    await page.waitForLoadState('networkidle');
    await page.locator('[data-testid="rsvp-accept"]').click();
    // Expect a capacity-exceeded message — the user must NOT see a
    // confirmation (the bug class we're guarding against is silently
    // accepting when the event is full).
    await expect(page.locator('[data-testid="rsvp-capacity-exceeded"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="rsvp-confirmed"]')).toHaveCount(0);
  });
});
