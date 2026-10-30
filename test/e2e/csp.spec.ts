import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// The script-src the hosted docs send. It has no 'unsafe-eval' and no 'wasm-unsafe-eval'.
const SCRIPT_SRC = [
  "script-src 'self' 'unsafe-inline' blob:",
  '*.awsstatic.com *.cdn.uis.awsstatic.com *.cdn.console.awsstatic.com',
  'd2c.aws.amazon.com a0.awsstatic.com *.feedback.console.aws.dev *.shortbread.aws.dev',
  '*.awswaf.com *.contentsquare.net app.contentsquare.com',
].join(' ');

interface Violation {
  directive: string;
  blockedURI: string;
}

// Runs as a script in the served HTML, so the page's CSP applies to it, unlike page.evaluate or addScriptTag.
const EVAL_PROBE =
  "<script>try { new Function('return 1')(); window.__evalRan = true; } catch (e) { window.__evalRan = false; }</script>";

/** Serves every document with the hosted CSP and records each violation the browser reports. */
async function withHostedCsp(page: Page, { evalProbe = false } = {}): Promise<() => Promise<Violation[]>> {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: evalProbe ? html.replace('<head>', `<head>${EVAL_PROBE}`) : html,
      headers: { ...response.headers(), 'content-security-policy': SCRIPT_SRC },
    });
  });
  await page.addInitScript(() => {
    const seen: Violation[] = [];
    (window as unknown as { __cspViolations: Violation[] }).__cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
  });
  return () => page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations);
}

/** Violations the site causes. The AWS docs boot script is same-origin when hosted but cross-origin locally. */
function ownViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => !v.blockedURI.startsWith('https://docs.aws.amazon.com/'));
}

test.describe('hosted content security policy', () => {
  test('appearance options stay plain in the built site data', async ({ request }) => {
    const html = await (await request.get(TOPIC_PAGE)).text();
    const metadataPath = /\/assets\/chunks\/metadata\.[^"']+\.js/.exec(html)?.[0];
    expect(metadataPath).toBeDefined();
    const metadata = await (await request.get(metadataPath!)).text();
    expect(metadata).toContain('\\"appearance\\":{\\"disableTransition\\":false}');
    expect(metadata).not.toMatch(/onChanged|new Function|=>/);
  });

  test('is enforced on the served page', async ({ page }) => {
    const violations = await withHostedCsp(page, { evalProbe: true });
    await page.goto(TOPIC_PAGE);
    expect(await page.evaluate(() => (window as unknown as { __evalRan?: boolean }).__evalRan)).toBe(false);
    expect(await violations()).toContainEqual({ directive: 'script-src', blockedURI: 'eval' });
  });

  test('an API page hydrates without a violation or page error', async ({ page }) => {
    const violations = await withHostedCsp(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar .api-sidebar-list li').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
    expect(ownViolations(await violations())).toEqual([]);
  });

  test('search returns results without a violation', async ({ page }) => {
    const violations = await withHostedCsp(page);

    await page.goto('/');
    await page.locator('.blog-search button').click();
    await page.locator('#search-input').fill('Topic');
    await expect(page.locator('.search-dialog .link').first()).toBeVisible({ timeout: 15_000 });

    expect(ownViolations(await violations())).toEqual([]);
  });
});
