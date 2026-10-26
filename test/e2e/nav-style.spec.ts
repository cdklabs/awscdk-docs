import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// Selectable navigation style (docs/adr/2026-10-23-sidebar-navigation-styles.md):
// the Settings menu offers By service (the default) and By package; the choice
// is stored under `cdk-docs-nav-style`; the sidebar regroups the data it
// already fetched, reveals the active page in the new tree, and keeps collapse
// and scroll memory apart per style. A reader who never opens the picker sees
// the service tree and makes no extra request.
test.describe('navigation style', () => {
  // The Settings dropdown and the sidebar are desktop surfaces.
  test.use({ viewport: { width: 1440, height: 900 } });

  const NAV_KEY = 'cdk-docs-nav-style';
  const EXPANDED_KEY = 'cdk-docs:sidebar-expanded:v1';

  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  async function dismissConsent(page: Page) {
    const accept = page.getByRole('button', { name: 'Accept' });
    if (await accept.count()) await accept.first().click();
  }

  async function openSettings(page: Page) {
    await dismissConsent(page);
    const trigger = page.getByRole('button', { name: 'Settings' });
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    return page.getByRole('group', { name: 'Navigation' });
  }

  const topLevel = (page: Page) => page.locator('.api-sidebar-nav > .api-sidebar-list > li');
  const topGroup = (page: Page, name: string) =>
    topLevel(page).filter({ has: page.locator(`:scope > button.api-sidebar-group:has-text("${name}")`) }).first();
  const topButton = (page: Page, name: string) => topGroup(page, name).locator(':scope > button.api-sidebar-group');

  /** Names of the api-sidebar assets fetched so far, in order. */
  function trackSidebarRequests(page: Page): string[] {
    const names: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      const at = url.indexOf('/api-sidebar/');
      if (at !== -1) names.push(url.slice(at + '/api-sidebar/'.length));
    });
    return names;
  }

  test('the Settings menu offers By service and By package, service active by default, nothing stored', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    const group = await openSettings(page);
    await expect(group).toBeVisible();
    // A visible caption, as the theme groups have.
    await expect(page.locator('.SettingsMenu .nav-style-group-label')).toHaveText('Navigation');
    const buttons = group.getByRole('button');
    await expect(buttons).toHaveText(['By service', 'By package']);
    await expect(group.getByRole('button', { name: 'By service' })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: 'By package' })).toHaveAttribute('aria-pressed', 'false');
    // Same control family: a 40px track and segments at or above the 24px target floor.
    const track = await group.boundingBox();
    expect(track?.height).toBe(40);
    for (const box of await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(24);
    }
    expect(await page.evaluate((key) => window.localStorage.getItem(key), NAV_KEY)).toBeNull();
    // The service tree: Framework and Services headings.
    await expect(page.locator('.api-sidebar-nav > .api-sidebar-list > li > p.api-sidebar-section-title')).toHaveText(['Framework', 'Services']);
  });

  test('switching to By package regroups at once, with no new request, and reveals the active page', async ({ page }) => {
    const requests = trackSidebarRequests(page);
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active')).toBeVisible();
    const before = [...requests];
    expect(before.length).toBeGreaterThan(0);

    const group = await openSettings(page);
    await group.getByRole('button', { name: 'By package' }).click();
    await expect(group.getByRole('button', { name: 'By package' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), NAV_KEY)).toBe('package');

    // No skeleton, no loading state, no fetch: the same data regrouped.
    await expect(page.locator('.api-sidebar-status')).toHaveCount(0);
    await expect(topButton(page, 'API Reference')).toHaveAttribute('aria-expanded', 'true');
    await expect(topGroup(page, 'API Reference').locator('a.api-sidebar-link')).toHaveText(['Overview']);
    await expect(topButton(page, 'aws-cdk-lib.aws_sqs')).toHaveAttribute('aria-expanded', 'true');
    await expect(topButton(page, 'aws-cdk-lib.aws_sns')).toHaveAttribute('aria-expanded', 'false');
    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('href', /aws-cdk-lib\.aws_sqs\.Queue/);
    await expect(active).toBeInViewport();
    expect(requests).toEqual(before);
    // Same page, same URL.
    expect(page.url()).toContain('aws-cdk-lib.aws_sqs.Queue');
  });

  test('a stored package choice applies on load, and opening a package fetches only its chunk', async ({ page }) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, 'package');
    }, NAV_KEY);
    const requests = trackSidebarRequests(page);
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await expect(topButton(page, 'API Reference')).toHaveAttribute('aria-expanded', 'true');
    await expect(topButton(page, 'aws-cdk-lib.aws_sqs')).toHaveAttribute('aria-expanded', 'true');
    // The same two assets a service-style load makes: the skeleton and the active page's chunk.
    expect(requests.filter((name) => name.startsWith('chunks/'))).toHaveLength(1);
    expect(requests.filter((name) => name.startsWith('chunks/'))[0]).toMatch(/^chunks\/sqs\./);

    const sns = topGroup(page, 'aws-cdk-lib.aws_sns');
    await topButton(page, 'aws-cdk-lib.aws_sns').click();
    await expect(sns.locator('.api-sidebar-section-title').first()).toHaveText('Constructs');
    await expect(sns.locator('a.api-sidebar-link', { hasText: 'Topic' }).first()).toBeVisible();
    const chunks = requests.filter((name) => name.startsWith('chunks/'));
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatch(/^chunks\/sns\./);
  });

  test('collapse memory is kept per style: a package toggle lands in the suffixed store and the service store stays empty', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    const group = await openSettings(page);
    await group.getByRole('button', { name: 'By package' }).click();
    await expect(topButton(page, 'API Reference')).toHaveAttribute('aria-expanded', 'true');
    await topButton(page, 'API Reference').click();
    await expect(topButton(page, 'API Reference')).toHaveAttribute('aria-expanded', 'false');

    const stores = await page.evaluate((key) => [
      window.localStorage.getItem(key),
      window.localStorage.getItem(`${key}:package`),
    ], EXPANDED_KEY);
    expect(stores[0]).toBeNull();
    expect(JSON.parse(stores[1]!)).toEqual([['API Reference', false]]);

    // Back to service: its own defaults, untouched by the package toggle.
    await (await openSettings(page)).getByRole('button', { name: 'By service' }).click();
    await expect(page.locator('.api-sidebar-nav > .api-sidebar-list > li > p.api-sidebar-section-title')).toHaveText(['Framework', 'Services']);
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active')).toHaveCount(1);

    // And the package choice is still there when the reader comes back.
    await (await openSettings(page)).getByRole('button', { name: 'By package' }).click();
    await expect(topButton(page, 'API Reference')).toHaveAttribute('aria-expanded', 'false');
    await expect(topButton(page, 'aws-cdk-lib.aws_sqs')).toHaveAttribute('aria-expanded', 'true');
  });

  test('navigating in the package style reveals the new page and keeps the filter working', async ({ page }) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, 'package');
    }, NAV_KEY);
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await dismissConsent(page);

    // A navigation into another package opens that package and marks the page.
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);
    await expect(topButton(page, 'aws-cdk-lib.aws_sns')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active')).toHaveAttribute('href', /aws_sns\.Topic/);

    // The navigation filter prunes the package tree like the service tree: it
    // needs every chunk, fetches them, and keeps only entries whose own or
    // ancestor text matches. The SQS package keeps `Queue`; SNS drops out.
    await page.getByPlaceholder('Filter navigation…').fill('queue');
    const sqs = topLevel(page).filter({ hasText: 'aws-cdk-lib.aws_sqs' });
    await expect(sqs).toHaveCount(1);
    await expect(sqs.locator('a.api-sidebar-link', { hasText: /^Queue$/ })).toBeVisible();
    await expect(topLevel(page).filter({ hasText: 'aws-cdk-lib.aws_sns' })).toHaveCount(0);
    await expect(topLevel(page).filter({ hasText: 'API Reference' })).toHaveCount(0);
  });

  test('an unknown stored value falls back to the service style', async ({ page }) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, 'alphabetical');
    }, NAV_KEY);
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await expect(page.locator('.api-sidebar-nav > .api-sidebar-list > li > p.api-sidebar-section-title')).toHaveText(['Framework', 'Services']);
    const group = await openSettings(page);
    await expect(group.getByRole('button', { name: 'By service' })).toHaveAttribute('aria-pressed', 'true');
  });
});
