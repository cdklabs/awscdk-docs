import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAILING_IMPACTS, QUEUE_PAGE } from './fixture.js';

const PREVIEW_KEY = 'cdk-docs-explorer-preview';
const VIEW_KEY = 'cdk-docs-explorer-view';
const FAVORITES = [
  { path: '/v2/docs/aws-cdk-lib.aws_sns.Topic', title: 'Topic' },
  { path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue', title: 'Queue' },
];

// Axe over what the Explorer preview adds, with the preview on: the rail, the gear's Settings panel, the Favorites
// view, the phone rail and Views button, and dark mode. Scoped to the top bar and the sidebar without its tree,
// so the audit stays quick and never meets the vendored code-token colors. The Pagefind search button is left out:
// below 768px it has no accessible name with the preview off too, and it is not part of this feature.
async function audit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'label-content-name-mismatch': { enabled: true } } })
    .include('.VPNav')
    .include('.VPSidebar')
    .exclude('.api-sidebar')
    .exclude('.nav-search-btn-wait')
    .analyze();
  const failing = results.violations.filter(
    (v) => v.impact && (FAILING_IMPACTS as readonly string[]).includes(v.impact),
  );
  const detail = failing
    .map((v) => `${v.id} (${v.impact}) — ${v.help} — first at: ${v.nodes[0]?.target?.join(' ') ?? 'unknown target'}`)
    .join('\n');
  expect(detail, `axe-core found gating violations on ${label}:\n${detail}`).toBe('');
}

async function open(page: Page, stored: Record<string, string>): Promise<void> {
  await page.addInitScript(
    ([entries, favorites]) => {
      for (const [key, value] of Object.entries(entries as Record<string, string>)) window.localStorage.setItem(key, value);
      window.localStorage.setItem('cdk-docs:favourites', JSON.stringify(favorites));
    },
    [{ [PREVIEW_KEY]: 'on', ...stored }, FAVORITES] as const,
  );
  await page.goto(QUEUE_PAGE);
  const accept = page.getByRole('button', { name: 'Accept' });
  if (await accept.count()) await accept.first().click();
  await expect(page.locator('#explorer-rail')).toBeAttached();
}

test.describe('explorer preview accessibility audit (axe-core) @a11y', () => {
  test.describe.configure({ timeout: 300_000 });

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the rail with the gear panel open has no critical or serious violations', async ({ page }) => {
      await open(page, {});
      await page.locator('.VPNavBar .settings-trigger').click();
      await expect(page.locator('#settings-menu-panel')).toBeVisible();
      await audit(page, 'the rail with the gear panel open');
    });

    test('the Favorites view has no critical or serious violations', async ({ page }) => {
      await open(page, { [VIEW_KEY]: 'favorites' });
      await expect(page.locator('.favorites-static-heading')).toBeVisible();
      await audit(page, 'the Favorites view');
    });

    test('dark mode has no critical or serious violations', async ({ page }) => {
      await open(page, { 'vitepress-theme-appearance': 'dark', [VIEW_KEY]: 'favorites' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      await audit(page, 'the Favorites view in dark mode');
      await page.locator('.VPNavBar .settings-trigger').click();
      await expect(page.locator('#settings-menu-panel')).toBeVisible();
      await audit(page, 'the Settings panel in dark mode');
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 375, height: 760 } });

    test('the unfolded rail and the Views button have no critical or serious violations', async ({ page }) => {
      await open(page, {});
      await page.locator('.VPLocalNav button.menu').click();
      await audit(page, 'the drawer with the Views button');
      await page.getByRole('button', { name: /^Views/ }).click();
      await audit(page, 'the unfolded phone rail');
    });

    test('the Views button and the unfolded rail in dark mode have no critical or serious violations', async ({
      page,
    }) => {
      await open(page, { 'vitepress-theme-appearance': 'dark' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.locator('.VPLocalNav button.menu').click();
      await audit(page, 'the drawer with the Views button in dark mode');
      await page.getByRole('button', { name: /^Views/ }).click();
      await audit(page, 'the unfolded phone rail in dark mode');
    });
  });
});
