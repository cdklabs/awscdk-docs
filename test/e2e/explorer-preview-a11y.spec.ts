import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CONSTRUCT_PAGE, FAILING_IMPACTS, QUEUE_PAGE } from './fixture.js';

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
async function audit(page: Page, label: string, withTree = false): Promise<void> {
  let builder = new AxeBuilder({ page })
    .options({ rules: { 'label-content-name-mismatch': { enabled: true } } })
    .include('.VPNav')
    .include('.VPSidebar')
    .exclude('.nav-search-btn-wait');
  // The Services view IS the tree, so its audits keep `.api-sidebar` in.
  if (!withTree) builder = builder.exclude('.api-sidebar');
  const results = await builder.analyze();
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

// Removes the seeded favorites one by one, so the Favorites view shows its empty line.
async function emptyFavorites(page: Page): Promise<void> {
  const section = page.locator('.favorites-section');
  for (const { title } of FAVORITES) {
    await section.getByRole('button', { name: `Remove ${title} from favorites` }).click();
  }
  await expect(section.locator('.favorites-empty')).toBeVisible();
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
      await emptyFavorites(page);
      await audit(page, 'the empty Favorites view');
    });

    // The Services view with the active page's service open, a kind group open, the filter active, and the dimmed
    // Locate control with its tooltip showing (docs/adr/2026-11-28-explorer-services-view.md).
    for (const [mode, stored] of [
      ['light', {}],
      ['dark', { 'vitepress-theme-appearance': 'dark' }],
    ] as const) {
      test(`the Services view in ${mode} mode has no critical or serious violations`, async ({ page }) => {
        await open(page, { ...stored, [VIEW_KEY]: 'services' });
        if (mode === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        const list = page.getByRole('navigation', { name: 'Services', exact: true });
        await expect(list.getByRole('button', { name: /^SQS, / })).toHaveAttribute('aria-expanded', 'true');
        await audit(page, `the Services view with SQS open in ${mode} mode`, true);
        const others = list.locator('.api-sidebar-part[data-part="Types"] [data-kind-group] > .api-sidebar-group').filter({ hasText: 'Others' });
        await others.click();
        await expect(others).toHaveAttribute('aria-expanded', 'true');
        await audit(page, `the Services view with a kind group open in ${mode} mode`, true);
        await page.getByPlaceholder('Filter navigation…').fill('queue');
        await expect(list.getByRole('button', { name: /^SQS, \d+ match/ })).toBeVisible();
        await audit(page, `the filtered Services view in ${mode} mode`, true);
        await page.getByPlaceholder('Filter navigation…').fill('');
        await page.goto(CONSTRUCT_PAGE);
        const locate = page.locator('button.sidebar-jump-current');
        await expect(locate).toHaveAttribute('aria-disabled', 'true');
        await locate.hover();
        await expect(page.getByRole('tooltip')).toBeVisible();
        await audit(page, `the dimmed Locate control with its tooltip in ${mode} mode`, true);
      });
    }

    test('dark mode has no critical or serious violations', async ({ page }) => {
      await open(page, { 'vitepress-theme-appearance': 'dark', [VIEW_KEY]: 'favorites' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      await audit(page, 'the Favorites view in dark mode');
      await emptyFavorites(page);
      await audit(page, 'the empty Favorites view in dark mode');
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
