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

// Removes whatever favorites are left, so the Favorites view shows its empty line.
async function emptyFavorites(page: Page): Promise<void> {
  const section = page.locator('.favorites-section');
  const remove = section.getByRole('button', { name: /^Remove / });
  for (let left = await remove.count(); left > 0; left--) {
    await remove.first().click();
  }
  await expect(section.locator('.favorites-empty')).toBeVisible();
}

/** Opens the first row's menu, which exists only while it is open. */
async function openRowMenu(page: Page): Promise<void> {
  const row = page.locator('.favorites-section .favorites-item').first();
  await row.getByRole('button', { name: /^Actions for / }).click();
  await expect(row.getByRole('menu')).toBeVisible();
}

/** Takes an open row menu to its "Move to group" level, a second set of items. */
async function openMoveLevel(page: Page): Promise<void> {
  const row = page.locator('.favorites-section .favorites-item').first();
  await row.getByRole('menuitem', { name: 'Move to group…' }).click();
  await expect(row.getByRole('menuitemradio').first()).toBeVisible();
}

/** Opens the first group heading's menu, once the sidebar has stopped moving. */
async function openGroupMenu(page: Page): Promise<void> {
  const head = page.locator('.favorites-section .favorites-group-head').first();
  await settle(page);
  await head.getByRole('button', { name: /^Actions for group / }).click();
  await expect(head.getByRole('menu')).toBeVisible();
}

/** Waits for the sidebar's own transitions and scrolling, so a click does not chase a moving button. */
async function settle(page: Page): Promise<void> {
  const sidebar = page.locator('.VPSidebar');
  await expect
    .poll(() => sidebar.evaluate((el) => el.getAnimations({ subtree: true }).length === 0))
    .toBe(true);
  let last = -1;
  await expect
    .poll(async () => {
      const top = await sidebar.evaluate((el) => el.scrollTop);
      const same = top === last;
      last = top;
      return same;
    })
    .toBe(true);
}

/** Leaves a name field showing its error, which is a state of its own. */
async function refuseGroupName(page: Page): Promise<void> {
  const section = page.locator('.favorites-section');
  await section.getByRole('button', { name: 'New group' }).click();
  const field = section.getByRole('textbox', { name: 'New group name' });
  const taken = await section.locator('.favorites-group-name').first().textContent();
  await field.fill(taken!.trim());
  await field.press('Enter');
  await expect(section.locator('.favorites-name-error')).toBeVisible();
}

/** The Favorites view inside the phone drawer, which holds the sidebar below 960px. */
async function openDrawer(page: Page): Promise<void> {
  await open(page, { [VIEW_KEY]: 'favorites' });
  await page.locator('.VPLocalNav button.menu').click();
  await expect(page.locator('.favorites-static-heading')).toBeVisible();
}

/**
 * The states of the Favorites view that exist only while something is open:
 * each menu level, a refused name and the Undo toast.
 */
async function auditFavoritesStates(page: Page, label: string): Promise<void> {
  await audit(page, `the Favorites view ${label}`);
  await openRowMenu(page);
  await audit(page, `the Favorites view with a row menu open ${label}`);
  await openMoveLevel(page);
  await audit(page, `the Favorites view with the Move to group list open ${label}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openGroupMenu(page);
  await audit(page, `the Favorites view with a group menu open ${label}`);
  await page.keyboard.press('Escape');
  await refuseGroupName(page);
  await audit(page, `the Favorites view with a refused group name ${label}`);
  await page.keyboard.press('Escape');
  await showToast(page);
  await audit(page, `the Favorites view with the Undo toast showing ${label}`);
}

/**
 * Removes one favorite, which is what puts the Undo toast on the page. Below
 * 960px the row has no ✕, so the removal goes through its menu, as a reader's
 * would.
 */
async function showToast(page: Page): Promise<void> {
  const section = page.locator('.favorites-section');
  const remove = section.getByRole('button', { name: /^Remove / }).first();
  if (await remove.isVisible()) {
    await remove.click();
  } else {
    await openRowMenu(page);
    await section.getByRole('menuitem', { name: 'Remove from Favorites' }).click();
  }
  await expect(section.locator('.favorites-toast')).toBeVisible();
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
      await auditFavoritesStates(page, 'at 1280px');
      await emptyFavorites(page);
      await audit(page, 'the empty Favorites view');
    });

    test('dark mode has no critical or serious violations', async ({ page }) => {
      await open(page, { 'vitepress-theme-appearance': 'dark', [VIEW_KEY]: 'favorites' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      await auditFavoritesStates(page, 'in dark mode');
      await emptyFavorites(page);
      await audit(page, 'the empty Favorites view in dark mode');
      await page.locator('.VPNavBar .settings-trigger').click();
      await expect(page.locator('#settings-menu-panel')).toBeVisible();
      await audit(page, 'the Settings panel in dark mode');
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 375, height: 760 } });

    // Split in two, so the per-test budget holds: the phone drawer is slower
    // to settle than the desktop sidebar, and each audit is a scan of its own.
    test('the Favorites view and both menu levels have no critical or serious violations at 375px', async ({
      page,
    }) => {
      await openDrawer(page);
      await audit(page, 'the Favorites view at 375px');
      await openRowMenu(page);
      await audit(page, 'the Favorites view with a row menu open at 375px');
      await openMoveLevel(page);
      await audit(page, 'the Favorites view with the Move to group list open at 375px');
    });

    test('a group menu, a refused name and the Undo toast have no critical or serious violations at 375px', async ({
      page,
    }) => {
      await openDrawer(page);
      await openGroupMenu(page);
      await audit(page, 'the Favorites view with a group menu open at 375px');
      await page.keyboard.press('Escape');
      await refuseGroupName(page);
      await audit(page, 'the Favorites view with a refused group name at 375px');
      await page.keyboard.press('Escape');
      await showToast(page);
      await audit(page, 'the Favorites view with the Undo toast showing at 375px');
    });

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
