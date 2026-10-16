import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Drives the real AWS docs boot script, so this spec needs network access to docs.aws.amazon.com.
// Shortbread only shows the banner to visitors it geolocates to the EU; its probe returns 403 for "not EU",
// so answering it 200 makes the banner deterministic wherever the runner sits.

const GEOLOCATION_PROBE = /prod\.tools\.shortbread\.aws\.dev/;
const CONSENT_COOKIE = 'awsccc';
const BANNER = '#awsccc-cb-c';
const FOOTER_LINK = '#awsdocs-cookie-preferences-link';

async function visitAsEuVisitor(page: Page, path: string) {
  await page.route(GEOLOCATION_PROBE, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
  );
  await page.goto(path);
}

async function acceptAll(page: Page) {
  await page.locator(BANNER).getByRole('button', { name: 'Accept all cookies' }).click({ timeout: 15_000 });
}

// The boot script sets `onclick` on the footer link at DOM-ready; once set, it has loaded and found the link.
async function waitForBootScriptBinding(page: Page) {
  await expect
    .poll(
      () => page.locator(FOOTER_LINK).evaluate((el) => typeof (el as { onclick?: unknown }).onclick === 'function'),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function consentCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === CONSENT_COOKIE);
}

function preferencesModal(page: Page) {
  return page.getByRole('dialog', { name: 'Customize cookie preferences' });
}

test.describe('AWS cookie-consent banner', () => {
  test('appears on first visit and never again once a choice is made', async ({ page }) => {
    await visitAsEuVisitor(page, '/');

    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    expect(await consentCookie(page)).toBeUndefined();

    await acceptAll(page);
    await expect(banner).toBeHidden();
    expect(await consentCookie(page)).toBeDefined();

    await page.reload();
    await waitForBootScriptBinding(page);
    await expect(banner).toBeHidden();

    await page.goto(TOPIC_PAGE);
    await waitForBootScriptBinding(page);
    await expect(banner).toBeHidden();
  });

  test('the footer "Cookie preferences" link reopens the preferences modal', async ({ page }) => {
    await visitAsEuVisitor(page, TOPIC_PAGE);
    await acceptAll(page);
    await waitForBootScriptBinding(page);

    const link = page.locator(FOOTER_LINK);
    await expect(link).toHaveText('Cookie preferences');
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(preferencesModal(page)).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('the link keeps working after client-side navigation', async ({ page }) => {
    await visitAsEuVisitor(page, '/');
    await acceptAll(page);
    await waitForBootScriptBinding(page);

    await page.locator('.VPNavBarMenu').getByRole('link', { name: 'API Reference' }).click();
    await expect(page).toHaveURL(/\/v2\/$/);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();

    const link = page.locator(FOOTER_LINK);
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(preferencesModal(page)).toBeVisible();
  });
});
