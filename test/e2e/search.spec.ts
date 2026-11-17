import { expect, test } from '@playwright/test';
import { SQS_OVERVIEW_PAGE, TOPIC_PAGE } from './fixture.js';
import { MAX_SEARCH_RESULTS, MODULE_HINT_CLASS } from '../../docs/.vitepress/theme/search-client.js';
import { SEARCH_DIALOG_LEAVING_CLASS, SEARCH_DIALOG_SELECTOR, SEARCH_KEYSHORTCUTS } from '../../docs/.vitepress/theme/search-hotkeys.js';

// Pagefind static search (vitepress-plugin-pagefind): the navbar
// search button opens the search dialog; querying a symbol documented in the
// fixture returns results from the Pagefind index built with the site.
test.describe('pagefind search', () => {
  test('querying a known symbol returns results', async ({ page }) => {
    await page.goto('/');

    const searchButton = page.locator('.blog-search button');
    await expect(searchButton).toBeVisible();
    await searchButton.click();

    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    await input.fill('Topic');

    // Pagefind loads its index chunks on demand; allow it a moment.
    const results = page.locator('.search-dialog .link');
    await expect(results.first()).toBeVisible({ timeout: 15_000 });
    expect(await results.count()).toBeGreaterThan(0);
  });

  test('a broad query loads only the capped result fragments', async ({ page }) => {
    const fragments = new Set<string>();
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/pagefind/fragment/') && path.endsWith('.pf_fragment')) {
        fragments.add(path);
      }
    });

    await page.goto('/');
    const uncappedResults = await page.evaluate(async () => {
      const preload = document.querySelector<HTMLLinkElement>(
        'link[rel="modulepreload"][href$="pagefind/pagefind.js"]',
      );
      if (!preload) return 0;
      const pagefind = await import(/* @vite-ignore */ preload.href);
      await pagefind.init?.();
      const search = await pagefind.search('construct');
      return search.results.length;
    });
    expect(uncappedResults).toBeGreaterThan(MAX_SEARCH_RESULTS);

    await page.locator('.blog-search button').click();
    await page.locator('#search-input').fill('construct');
    await expect(page.locator('.search-dialog .link').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[command-group-heading]')).toHaveText(
      `Top ${MAX_SEARCH_RESULTS} results`,
    );
    await page.waitForLoadState('networkidle');

    expect(fragments.size).toBe(MAX_SEARCH_RESULTS);
  });

  test('the built index finds member owners and keeps exact types first', async ({ page }) => {
    await page.goto('/');
    const results = await page.evaluate(async () => {
      const preload = document.querySelector<HTMLLinkElement>(
        'link[rel="modulepreload"][href$="pagefind/pagefind.js"]',
      );
      if (!preload) return {};
      const pagefind = await import(/* @vite-ignore */ preload.href);
      await pagefind.init?.();
      const urlsFor = async (query: string) => {
        const search = await pagefind.search(query);
        const data = await Promise.all(search.results.map((result: { data(): Promise<{ url: string }> }) => result.data()));
        return data.map((entry: { url: string }) => entry.url);
      };
      return {
        property: await urlsFor('maxMessageSizeBytes'),
        method: await urlsFor('tryRemoveChild'),
        type: await urlsFor('Node'),
      };
    });

    expect(results.property).toContain('/v2/docs/aws-cdk-lib.aws_sqs.QueueProps.html');
    expect(results.method).toContain('/v2/docs/constructs.Node.html');
    expect(results.type?.[0]).toBe('/v2/docs/constructs.Node.html');
  });

  // A member excerpt separates the name from its flags and never contains the permalink glyph.
  test('a member excerpt separates the header parts and leaves out the permalink', async ({ page }) => {
    await page.goto('/');
    const excerpt = await page.evaluate(async () => {
      const preload = document.querySelector<HTMLLinkElement>(
        'link[rel="modulepreload"][href$="pagefind/pagefind.js"]',
      );
      if (!preload) return undefined;
      const pagefind = await import(/* @vite-ignore */ preload.href);
      await pagefind.init?.();
      const search = await pagefind.search('fromQueueArn');
      const data = await Promise.all(search.results.map(
        (result: { data(): Promise<{ url: string; excerpt: string }> }) => result.data(),
      ));
      const queue = data.find((entry: { url: string }) => entry.url === '/v2/docs/aws-cdk-lib.aws_sqs.Queue.html');
      return queue?.excerpt.replace(/<\/?mark>/g, '');
    });

    expect(excerpt).toMatch(/fromQueueArn\S*\s+static\b/);
    expect(excerpt).not.toMatch(/static\s*#/);
  });

  // The fixture documents aws-sns and aws-sqs; `Topic` is an SNS construct.
  test.describe('module: filter', () => {
    const search = async (page: import('@playwright/test').Page, query: string) => {
      await page.goto('/');
      await page.locator('.blog-search button').click();
      const input = page.locator('#search-input');
      await expect(input).toBeVisible();
      await input.fill(query);
    };

    // Every rendered result carries its page route in data-value (the group heading carries its text there
    // too), so the module a result belongs to is readable.
    const routes = async (page: import('@playwright/test').Page) => {
      const items = page.locator('.search-dialog [data-value^="/"]');
      await expect(items.first()).toBeVisible({ timeout: 15_000 });
      return items.evaluateAll((els) => els.map((el) => el.getAttribute('data-value') ?? ''));
    };

    test('accepts the underscore spelling readers see in the sidebar', async ({ page }) => {
      await search(page, 'module:aws_sns topic');
      const found = await routes(page);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((route) => route.includes('aws_sns'))).toBe(true);
    });

    test('a word prefix selects the module it starts', async ({ page }) => {
      await search(page, 'module:sns topic');
      const found = await routes(page);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((route) => route.includes('aws_sns'))).toBe(true);
    });

    test('a prefix shared by several modules selects all of them', async ({ page }) => {
      // `s` starts both fixture modules, so the engine receives an any-of filter.
      await search(page, 'module:s queue');
      const found = await routes(page);
      expect(found.some((route) => route.includes('aws_sqs'))).toBe(true);
      await search(page, 'module:s topic');
      expect((await routes(page)).some((route) => route.includes('aws_sns'))).toBe(true);
    });

    test('a module with no results for the text shows the hint', async ({ page }) => {
      await search(page, 'module:aws_sqs zzqqxxnothing');
      const hint = page.locator(`.search-dialog .${MODULE_HINT_CLASS}`);
      await expect(hint).toBeVisible({ timeout: 15_000 });
      await expect(hint).toContainText('No results in that module');
      await expect(page.locator('.search-dialog .link')).toHaveCount(0);
    });

    test('a module that matches nothing shows close module names instead of results', async ({ page }) => {
      // The live region exists, empty, before its first message -- and stays in the accessibility tree
      // (collapsed, not display:none), or a polite region appearing with its text would not be announced.
      await search(page, 'module:sns topic');
      const hint = page.locator(`.search-dialog .${MODULE_HINT_CLASS}`);
      await expect(page.locator('.search-dialog .link').first()).toBeVisible({ timeout: 15_000 });
      await expect(hint).toBeAttached();
      await expect(hint).toHaveAttribute('role', 'status');
      await expect(hint).toHaveText('');
      expect(await hint.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');

      await page.locator('#search-input').fill('module:snss topic');
      await expect(hint).toBeVisible({ timeout: 15_000 });
      await expect(hint).toContainText('No module matches module:snss');
      await expect(hint).toContainText('aws-sns');
      await expect(page.locator('.search-dialog .link')).toHaveCount(0);
      // Correcting the token clears the hint; the live region stays, empty and collapsed.
      await page.locator('#search-input').fill('module:sns topic');
      await expect(page.locator('.search-dialog .link').first()).toBeVisible({ timeout: 15_000 });
      await expect(hint).toHaveText('');
      await expect(hint).toBeHidden();
      expect(await hint.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
    });
  });

  test.describe('service overview pin', () => {
    // The fixture documents only two services, so `SQS` and `sqs` already rank the overview first
    // here; on the full site they do not. `aws_sqs` puts it 16th in this fixture without the pin.
    for (const query of ['SQS', 'sqs', 'aws_sqs']) {
      test(`typing ${query} puts the SQS overview first`, async ({ page }) => {
        await page.goto('/');
        await page.locator('.blog-search button').click();
        await page.locator('#search-input').fill(query);
        // Result items carry their page route in data-value, with the matched section's anchor.
        const first = page.locator('.search-dialog [data-value^="/"]').first();
        await expect(first).toBeVisible({ timeout: 15_000 });
        expect((await first.getAttribute('data-value'))?.split('#')[0]).toBe(SQS_OVERVIEW_PAGE);
      });
    }
  });

  test('the search dialog opens and closes', async ({ page }) => {
    await page.goto('/');

    await page.locator('.blog-search button').click();
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
  });

  // The `/` shortcut lives in the theme (search-hotkeys.ts), not in the plugin,
  // which only listens for Cmd+K / Ctrl+K and keeps its open state private.
  test.describe('/ shortcut', () => {
    test('/ opens search with the query input focused and empty', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.nav-search-btn-wait')).toBeVisible();

      await page.keyboard.press('/');
      const input = page.locator('#search-input');
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
      // The keydown's default action is prevented, so the slash is not typed.
      await expect(input).toHaveValue('');
    });

    test('/ opens search on the 404 page too', async ({ page }) => {
      await page.goto('/v2/docs/aws-cdk-lib.aws_s3.NoSuchThing');
      await expect(page.locator('.nav-search-btn-wait')).toBeVisible();

      await page.keyboard.press('/');
      await expect(page.locator('#search-input')).toBeVisible();
    });

    test('/ inside the navigation filter types a slash and does not open search', async ({ page }) => {
      await page.goto(TOPIC_PAGE);
      const filter = page.getByRole('textbox', { name: 'Filter navigation in the sidebar' });
      await filter.focus();

      await page.keyboard.press('/');
      await expect(filter).toHaveValue('/');
      await expect(page.locator('#search-input')).toHaveCount(0);
    });

    test('/ with a modifier held does not open search', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.nav-search-btn-wait')).toBeVisible();

      for (const combo of ['Control+/', 'Meta+/', 'Alt+/']) {
        await page.keyboard.press(combo);
        await expect(page.locator('#search-input')).toHaveCount(0);
      }
    });

    test('/ while the dialog is open leaves the dialog and query alone', async ({ page }) => {
      await page.goto('/');
      await page.locator('.blog-search button').click();
      const input = page.locator('#search-input');
      await expect(input).toBeFocused();
      await input.fill('Topic');
      // Move focus off every editable element, so only the open-dialog guard can keep the key quiet. The guard's
      // one visible effect is that the keydown keeps its default action, read by a listener that runs after the theme's.
      await input.blur();
      await expect(input).not.toBeFocused();
      await page.evaluate(() => {
        window.addEventListener('keydown', (event) => {
          document.documentElement.dataset.slashPrevented = String(event.defaultPrevented);
        });
      });

      await page.keyboard.press('/');
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('Topic');
      await expect(page.locator('html')).toHaveAttribute('data-slash-prevented', 'false');
    });

    test('the navbar search button announces its shortcuts', async ({ page }) => {
      await page.goto('/');
      const button = page.locator('.nav-search-btn-wait');
      await expect(button).toHaveAttribute('aria-keyshortcuts', SEARCH_KEYSHORTCUTS);
      // Visible text and accessible name stay the plugin's own.
      await expect(button).toHaveText(/Search/);
    });
  });

  // Preventing Escape's default while search is open is meant to keep Firefox
  // for macOS in fullscreen. Fullscreen cannot be driven in CI, so these assert
  // the page's side of it: defaultPrevented on the Escape keydown, dialog open
  // vs closed.
  test.describe('Escape and the browser default', () => {
    // Bubble-phase window listener, added after the theme's capture-phase one,
    // so it sees the final defaultPrevented of every keydown. It also records
    // whether the dialog was in its leave transition when each Escape fired.
    type Recorded = { __escapes: boolean[]; __leaving: boolean[] };
    async function recordEscapes(page: import('@playwright/test').Page) {
      await page.evaluate((leavingClass) => {
        const w = window as unknown as Recorded;
        w.__escapes = [];
        w.__leaving = [];
        window.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape') return;
          w.__escapes.push(e.defaultPrevented);
          w.__leaving.push(document.querySelector(`.${leavingClass}`) !== null);
        });
      }, SEARCH_DIALOG_LEAVING_CLASS);
    }
    const escapes = (page: import('@playwright/test').Page) =>
      page.evaluate(() => (window as unknown as Recorded).__escapes);
    const leaving = (page: import('@playwright/test').Page) =>
      page.evaluate(() => (window as unknown as Recorded).__leaving);

    test('Escape in the open dialog is prevented and still closes it', async ({ page }) => {
      await page.goto('/');
      await recordEscapes(page);

      await page.locator('.blog-search button').click();
      const input = page.locator('#search-input');
      await expect(input).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(input).toBeHidden();
      expect(await escapes(page)).toEqual([true]);
    });

    test('a second Escape while the dialog fades out keeps its default', async ({ page }) => {
      await page.goto('/');
      await recordEscapes(page);

      await page.locator('.blog-search button').click();
      await expect(page.locator('#search-input')).toBeVisible();

      // The first press closes search; the second lands while the dialog is
      // still in its leave transition and must keep its default.
      await page.keyboard.press('Escape');
      await expect(page.locator(`.${SEARCH_DIALOG_LEAVING_CLASS}`)).toHaveCount(1);
      await page.keyboard.press('Escape');
      // The plugin starts the leave transition from its own keydown listener,
      // before this recorder runs, so only the second entry is meaningful.
      expect((await leaving(page))[1]).toBe(true);
      expect(await escapes(page)).toEqual([true, false]);
    });

    test('Escape with the dialog closed keeps its default', async ({ page }) => {
      await page.goto('/');
      await recordEscapes(page);

      // Positive control first: a prevented Escape proves the theme's listener
      // is installed before the closed-dialog press is checked.
      await page.locator('.blog-search button').click();
      await expect(page.locator('#search-input')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(SEARCH_DIALOG_SELECTOR)).toHaveCount(0);
      await page.keyboard.press('Escape');
      expect(await escapes(page)).toEqual([true, false]);
    });

    test('typing in the open dialog keeps its default', async ({ page }) => {
      await page.goto('/');
      await page.locator('.blog-search button').click();
      const input = page.locator('#search-input');
      await expect(input).toBeVisible();
      await input.pressSequentially('Topic');
      await expect(input).toHaveValue('Topic');
    });

    test('Escape in the navigation filter keeps its default and clears it', async ({ page }) => {
      await page.goto(SQS_OVERVIEW_PAGE);
      const filter = page.locator('.nav-filter-input');
      await expect(filter).toBeVisible();
      await recordEscapes(page);

      await filter.fill('Queue');
      await filter.press('Escape');
      await expect(filter).toHaveValue('');
      expect(await escapes(page)).toEqual([false]);
    });
  });
});
