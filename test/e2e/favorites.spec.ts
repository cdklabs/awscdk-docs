import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE, SQS_OVERVIEW_PAGE, TOPIC_PAGE } from './fixture.js';

// Favorite pages: the doc-before star toggles a localStorage
// entry; starred pages appear in the sidebar's Favorites quick-access
// section and survive a full reload.
test.describe('favorite pages', () => {
  test('starring a page persists across reloads and lists it in the sidebar', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const star = page.locator('.favorite-star-button');
    await expect(star).toBeVisible();
    // The star teleports into the chip row under the title.
    await expect(page.locator('.type-header-row .favorite-star-button')).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.favorites-section')).toHaveCount(0);

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    // Icon-only control: the label lives in the hover text.
    await expect(star).toHaveAttribute('title', 'Remove from favorites');

    const section = page.locator('.favorites-section');
    await expect(section).toBeVisible();
    await expect(section.locator('.favorites-link')).toContainText('Topic');

    // localStorage persistence: still starred after a full reload.
    await page.reload();
    await expect(page.locator('.favorite-star-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.favorites-section .favorites-link')).toContainText('Topic');

    // The favorite follows to other API pages via the sidebar section.
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.favorites-section .favorites-link')).toContainText('Topic');
  });

  test('the star uses a larger glyph without crowding either placement', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TOPIC_PAGE);

    const inRowButton = page.locator('.type-header-row .favorite-star-button');
    const inRowIcon = inRowButton.locator('.favorite-star-icon');
    await expect(inRowIcon).toHaveCSS('font-size', '20px');
    await expect(inRowIcon).toHaveText('☆');

    // The star sits in the chip row, which is below the trail rather than at
    // its trailing edge.
    const trailBox = await page.locator('.breadcrumb-trail').boundingBox();
    const buttonBox = await inRowButton.boundingBox();
    expect(trailBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y).toBeGreaterThanOrEqual(trailBox!.y + trailBox!.height);

    await inRowButton.click();
    await expect(inRowIcon).toHaveText('★');
    await expect(inRowIcon).toHaveCSS('font-size', '20px');

    await page.goto('/v2/');
    const standaloneButton = page.locator('.favorite-star.standalone .favorite-star-button');
    const standaloneIcon = standaloneButton.locator('.favorite-star-icon');
    await expect(standaloneIcon).toBeVisible();
    await expect(standaloneIcon).toHaveCSS('font-size', '20px');
    await expect(standaloneIcon).toHaveText('☆');

    await standaloneButton.click();
    await expect(standaloneIcon).toHaveText('★');
    await expect(standaloneIcon).toHaveCSS('font-size', '20px');
  });

  // Measured rather than declared: font-size alone does not determine the
  // rendered glyph, so these read the box, the resolved family and the ink.
  const starMetrics = (page: Page) =>
    page.evaluate(() => {
      const button = document.querySelector(
        '.favorite-star-button',
      ) as HTMLElement;
      const icon = button.querySelector('.favorite-star-icon') as HTMLElement;
      const style = getComputedStyle(icon);
      const context = document
        .createElement('canvas')
        .getContext('2d') as CanvasRenderingContext2D;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const glyph = context.measureText((icon.textContent ?? '').trim());
      const lineBox = icon.getBoundingClientRect().height;
      const baseline =
        (lineBox -
          (glyph.fontBoundingBoxAscent + glyph.fontBoundingBoxDescent)) /
          2 +
        glyph.fontBoundingBoxAscent;
      const inkCenter =
        baseline + (glyph.actualBoundingBoxDescent - glyph.actualBoundingBoxAscent) / 2;
      const buttonBox = button.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      return {
        width: buttonBox.width,
        height: buttonBox.height,
        fontFamily: style.fontFamily,
        inkHeight:
          glyph.actualBoundingBoxAscent + glyph.actualBoundingBoxDescent,
        inkOffset:
          iconBox.y - buttonBox.y + inkCenter - buttonBox.height / 2,
      };
    });

  test('the star renders the same glyph, square and centered, in every placement', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // The chip row styles the star as a pill, so its BOX is deliberately
    // larger there than in the compact placements. The glyph is not: one
    // typeface, one ink height, centered in whatever box it gets.
    await page.goto(TOPIC_PAGE);
    const inRow = await starMetrics(page);

    await page.goto(SQS_OVERVIEW_PAGE);
    const inBar = await starMetrics(page);

    await page.goto('/v2/');
    const standalone = await starMetrics(page);

    for (const metrics of [inRow, inBar]) {
      expect(metrics.fontFamily).toBe(standalone.fontFamily);
      expect(metrics.inkHeight).toBeCloseTo(standalone.inkHeight, 1);
    }
    // The two compact placements render at one size.
    expect(inBar.width).toBeCloseTo(standalone.width, 1);
    expect(inBar.height).toBeCloseTo(standalone.height, 1);
    // ...and the pill is taller, which is the point of the row treatment.
    expect(inRow.height).toBeGreaterThan(inBar.height);

    for (const metrics of [inRow, inBar, standalone]) {
      expect(metrics.width).toBeGreaterThanOrEqual(24);
      expect(metrics.height).toBeGreaterThanOrEqual(24);
      expect(metrics.width).toBeCloseTo(metrics.height, 1);
      expect(Math.abs(metrics.inkOffset)).toBeLessThanOrEqual(0.5);
    }
  });

  test('on a type page the star is the last control of the chip row, not a second one', async ({ page }) => {
    // Teleported after mount, so the star exists only on the hydrated page;
    // the count guards against a second copy landing outside the row.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.type-header-row .type-action-fav .favorite-star')).toHaveCount(1);
    await expect(page.locator('.favorite-star-button')).toHaveCount(1);
    await expect(page.locator('.favorite-star.standalone')).toHaveCount(0);
    // And it still toggles from there, across a reload.
    const star = page.locator('.type-header-row .favorite-star-button');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('.type-header-row .favorite-star-button'))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('a client-side navigation between type pages re-finds the row', async ({ page }) => {
    // The mount point is resolved per content update; without that, SPA
    // navigation would leave the star teleported to the previous page's row.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.type-header-row .favorite-star-button')).toHaveCount(1);
    await page.locator('.vp-doc a[href$="aws-cdk-lib.aws_sns.TopicBase.html"]').first().click();
    await expect(page.locator('.vp-doc h1')).toHaveText('TopicBase');
    await expect(page.locator('.type-header-row .favorite-star-button')).toHaveCount(1);
    await expect(page.locator('.favorite-star-button')).toHaveCount(1);
  });

  test('a client-side navigation to an overview hands the star back to the breadcrumb bar', async ({ page }) => {
    // The row the star was teleported into no longer exists on the new page,
    // so the mount has to be re-resolved to `breadcrumb-fav`. Until that
    // happens the Teleport still points at a removed span, which no assertion
    // on the type page can see.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.type-header-row .type-action-fav .favorite-star')).toHaveCount(1);

    await page.locator('.type-breadcrumb a').last().click();
    await expect(page.locator('.vp-doc h1')).toHaveText(/Construct Library/);
    await expect(page.locator('.type-header-row')).toHaveCount(0);

    const star = page.locator('.type-breadcrumb .breadcrumb-fav .favorite-star-button');
    await expect(star).toBeVisible();
    await expect(page.locator('.favorite-star-button')).toHaveCount(1);
    // And it is styled for the bar it landed in, not still for the row.
    await expect(page.locator('.favorite-star')).toHaveClass(/in-bar/);
    await expect(page.locator('.favorite-star')).not.toHaveClass(/in-row/);
  });

  test('the star keeps a 44px target on a narrow viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(TOPIC_PAGE);

    const metrics = await starMetrics(page);
    expect(metrics.width).toBeGreaterThanOrEqual(44);
    expect(metrics.height).toBeGreaterThanOrEqual(44);
  });

  test('more than twenty pages can be favorited, with no cap message', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.evaluate(() => {
      const entries = Array.from({ length: 20 }, (_, i) => ({
        path: `/v2/docs/filler-${i}`,
        title: `Filler ${i}`,
      }));
      localStorage.setItem('cdk-docs:favourites', JSON.stringify(entries));
    });
    await page.reload();
    const star = page.locator('.type-header-row .favorite-star-button');
    await expect(star).toBeVisible();
    await star.click();

    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.favorite-star-cap')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('cdk-docs:favourites')!).length,
      ),
    ).toBe(21);
  });

  test('the star does not add height to the breadcrumb bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // An overview page is where the star shares the breadcrumb bar; on a type
    // page it lives in the chip row.
    await page.goto(SQS_OVERVIEW_PAGE);

    const measured = await page.evaluate(() => {
      const bar = document.querySelector('.type-breadcrumb') as HTMLElement;
      const button = document.querySelector(
        '.favorite-star-button',
      ) as HTMLElement;
      const style = getComputedStyle(bar);
      return {
        bar: bar.getBoundingClientRect().height,
        button: button.getBoundingClientRect().height,
        padding:
          parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      };
    });

    // The tallest thing in the bar is the control, so the bar is its height
    // plus the bar's own padding — no line box taller than the control.
    expect(measured.bar).toBeLessThanOrEqual(
      measured.button + measured.padding + 0.5,
    );
  });

  // Collapsible favorites section: collapsed by default so it
  // stops pushing the primary nav tree down, with the choice persisted.
  test('the favorites section is collapsed by default and the choice survives a reload', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.locator('.favorite-star-button').click();

    const toggle = page.locator('.favorites-toggle');
    const list = page.locator('#favorites-list');
    await expect(toggle).toBeVisible();
    // Collapsed on a first visit — the entries are in the DOM but hidden,
    // and the count is on the header so the feature stays discoverable.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();
    await expect(toggle).toContainText('(1)');

    // Keyboard-operable: the header is in the tab order and Enter toggles.
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(list).toBeVisible();
    await expect(list.locator('.favorites-link')).toContainText('Topic');

    // Expanded choice persists across a full reload…
    await page.reload();
    await expect(page.locator('.favorites-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#favorites-list')).toBeVisible();

    // …and across a route change to another API page.
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.favorites-toggle')).toHaveAttribute('aria-expanded', 'true');

    // Collapsing again persists too, so the default is not sticky.
    await page.locator('.favorites-toggle').click();
    await page.reload();
    await expect(page.locator('.favorites-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#favorites-list')).toBeHidden();
  });

  test('unstarring removes the page from the favorites section', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const star = page.locator('.favorite-star-button');
    await star.click();
    await expect(page.locator('.favorites-section')).toBeVisible();

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.favorites-section')).toHaveCount(0);
  });

  // Submodule overview pages carry the docgen breadcrumb bar too, so the
  // star must teleport into it there — not fall back to the standalone
  // doc-before placement — and still toggle correctly.
  test('the star teleports into the breadcrumb bar on a submodule overview page and toggles', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    // The overview page emits the shared breadcrumb bar with its
    // `breadcrumb-fav` mount point, and the star lands inside it.
    await expect(page.locator('.vp-doc .type-breadcrumb .breadcrumb-fav')).toHaveCount(1);
    const star = page.locator('.type-breadcrumb .favorite-star-button');
    await expect(star).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    // Exactly one star on the page: teleported, not duplicated by the
    // doc-before fallback.
    await expect(page.locator('.favorite-star-button')).toHaveCount(1);

    // Starring from the breadcrumb bar works and persists.
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.favorites-section .favorites-link')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.type-breadcrumb .favorite-star-button')).toHaveAttribute('aria-pressed', 'true');

    // Unstarring from the same placement clears it.
    await page.locator('.type-breadcrumb .favorite-star-button').click();
    await expect(page.locator('.type-breadcrumb .favorite-star-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.favorites-section')).toHaveCount(0);
  });
});

// The grouped Favorites view of the Explorer preview. Only a browser shows
// what the grouping, the menus, the inline fields and the Undo toast do: the
// unit suite pins the stored JSON these actions write, and the view is
// assembled client-side from it.
test.describe('grouped favorites view', () => {
  const PREVIEW_KEY = 'cdk-docs-explorer-preview';
  const VIEW_KEY = 'cdk-docs-explorer-view';
  const FAVORITES_KEY = 'cdk-docs:favourites';
  const GROUPS_KEY = 'cdk-docs:favourites:groups';
  const ALIASES_KEY = 'cdk-docs:favourites:aliases';
  const COLLAPSED_KEY = 'cdk-docs:favourites:collapsed-groups';

  const STARRED = [
    { path: '/v2/docs/aws-cdk-lib.aws_sns.Topic', title: 'Topic' },
    { path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue', title: 'Queue' },
    { path: '/v2/docs/constructs.Construct', title: 'Construct' },
  ];

  /** The view, with the preview on and the given pages already starred. */
  async function openView(
    page: Page,
    entries: readonly { path: string; title: string; group?: string | null }[] = STARRED,
    extra: Record<string, string> = {},
  ): Promise<void> {
    await page.addInitScript(
      ([preview, view, favorites, stored, keys]) => {
        const [previewKey, viewKey, favoritesKey] = keys as string[];
        window.localStorage.setItem(previewKey, preview as string);
        window.localStorage.setItem(viewKey, view as string);
        // Only when nothing is there yet: the script runs on every navigation,
        // so overwriting would undo what the view just stored.
        if (window.localStorage.getItem(favoritesKey) === null) {
          window.localStorage.setItem(favoritesKey, JSON.stringify(favorites));
          for (const [key, value] of Object.entries(stored as Record<string, string>)) {
            window.localStorage.setItem(key, value);
          }
        }
      },
      ['on', 'favorites', entries, extra, [PREVIEW_KEY, VIEW_KEY, FAVORITES_KEY]] as const,
    );
    await page.goto(QUEUE_PAGE);
    const accept = page.getByRole('button', { name: 'Accept' });
    if (await accept.count()) {
      await accept.first().click();
    }
    await expect(page.locator('.favorites-static-heading')).toBeVisible();
  }

  const view = (page: Page) => page.locator('.favorites-section');

  const stored = (page: Page, key: string) =>
    page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? 'null'), key);

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('favorites sit in groups named by the map, A to Z with rows A to Z', async ({ page }) => {
      await openView(page);
      await expect(view(page).locator('.favorites-group-name')).toHaveText([
        'Application integration',
        'Framework',
      ]);
      await expect(view(page).locator('.favorites-group-count')).toHaveText(['(2)', '(1)']);
      await expect(view(page).locator('.favorites-link')).toHaveText([
        'Queue · SQS',
        'Topic · SNS',
        'Construct · constructs',
      ]);
      // Each group is a list named after itself, under its heading button.
      await expect(page.getByRole('list', { name: 'Application integration' })).toBeVisible();
      // The full page id is the hover text, so two favorites with one name tell apart.
      await expect(view(page).locator('.favorites-link').first()).toHaveAttribute(
        'title',
        'aws-cdk-lib.aws_sqs.Queue',
      );
      // The map's answer is written back on the first read.
      expect(await stored(page, FAVORITES_KEY)).toEqual([
        { path: STARRED[0].path, title: 'Topic', group: 'Application integration' },
        { path: STARRED[1].path, title: 'Queue', group: 'Application integration' },
        { path: STARRED[2].path, title: 'Construct', group: 'Framework' },
      ]);
    });

    test('an unmapped page lands in Ungrouped, which sorts last', async ({ page }) => {
      await openView(page, [
        ...STARRED,
        { path: '/v2/docs/aws-cdk-lib.aws_scn.Thing', title: 'Thing' },
      ]);
      await expect(view(page).locator('.favorites-group-name')).toHaveText([
        'Application integration',
        'Framework',
        'Ungrouped',
      ]);
      // Ungrouped has no actions menu: it cannot be renamed or deleted.
      const ungrouped = view(page).locator('.favorites-group').last();
      await expect(ungrouped.getByRole('button', { name: /Actions for group/ })).toHaveCount(0);
    });

    test('a removal offers Undo, and Undo puts the row back where it was', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      await row.getByRole('button', { name: 'Remove Queue from Favorites' }).click();

      const toast = view(page).locator('.favorites-toast');
      await expect(toast).toHaveText(/Removed “Queue” from Favorites\./);
      await expect(view(page).getByRole('heading', { name: 'Favorites (2)' })).toBeVisible();
      await expect(view(page).locator('.favorites-link')).toHaveText([
        'Topic · SNS',
        'Construct · constructs',
      ]);

      await toast.getByRole('button', { name: 'Undo' }).click();
      await expect(view(page).locator('.favorites-link')).toHaveText([
        'Queue · SQS',
        'Topic · SNS',
        'Construct · constructs',
      ]);
      // Focus lands on the restored row, so the keyboard stays where the reader was.
      await expect(view(page).locator('.favorites-link').first()).toBeFocused();
    });

    test('a change after a removal withdraws the Undo offer, so it cannot take that change back', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      await row.getByRole('button', { name: 'Remove Queue from Favorites' }).click();
      await expect(view(page).locator('.favorites-toast')).toBeVisible();

      // Move another favorite while the offer is up. Undo would restore the
      // state from before the move as well, so the offer has to go.
      const topic = view(page).locator('.favorites-item').first();
      await topic.hover();
      await topic.getByRole('button', { name: 'Actions for Topic' }).click();
      await topic.getByRole('menuitem', { name: 'Move to group…' }).click();
      await topic.getByRole('menuitemradio', { name: 'Framework' }).click();

      await expect(view(page).locator('.favorites-toast')).toHaveCount(0);
      await expect(view(page).locator('.favorites-group-name')).toHaveText(['Framework']);
      await expect(view(page).locator('.favorites-link')).toHaveText([
        'Construct · constructs',
        'Topic · SNS',
      ]);
    });

    test('removing the only row of a group leaves focus inside the view', async ({ page }) => {
      await openView(page);
      // Construct is alone in Framework, so its heading goes with the row.
      await view(page).locator('[data-fav-link$="constructs.Construct"]').focus();
      await page.keyboard.press('Delete');
      await expect(view(page).locator('.favorites-group-name')).toHaveText([
        'Application integration',
      ]);
      expect(
        await page.evaluate(() =>
          document.activeElement?.closest('.favorites-section') !== null,
        ),
      ).toBe(true);
    });

    test('a move into a folded group unfolds it, so the row it moved is in sight', async ({ page }) => {
      await openView(page, STARRED, {
        'cdk-docs:favourites:collapsed-groups': JSON.stringify(['Framework']),
      });
      await expect(page.getByRole('list', { name: 'Framework' })).toBeHidden();

      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      await row.getByRole('button', { name: 'Actions for Queue' }).click();
      await row.getByRole('menuitem', { name: 'Move to group…' }).click();
      await row.getByRole('menuitemradio', { name: 'Framework' }).click();

      await expect(page.getByRole('list', { name: 'Framework' })).toBeVisible();
      await expect(view(page).locator('[data-fav-link$="aws_sqs.Queue"]')).toBeFocused();
    });

    test('a refused group name is announced and tied to the field', async ({ page }) => {
      await openView(page);
      await view(page).getByRole('button', { name: 'New group' }).click();
      const field = view(page).getByRole('textbox', { name: 'New group name' });
      await field.fill('Framework');
      await field.press('Enter');

      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toHaveAttribute('aria-describedby', 'favorites-name-error');
      await expect(view(page).locator('.favorites-live')).toHaveText(
        'A group named “Framework” already exists.',
      );
    });

    test('Ctrl+Z in a name field leaves the Undo offer alone', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      await row.getByRole('button', { name: 'Remove Queue from Favorites' }).click();
      await expect(view(page).locator('.favorites-toast')).toBeVisible();

      await view(page).getByRole('button', { name: 'New group' }).click();
      const field = view(page).getByRole('textbox', { name: 'New group name' });
      await field.fill('Mine');
      await field.press('Control+z');

      // The favorite is still gone: the field's own undo is what that key is for.
      await expect(view(page).locator('.favorites-link')).toHaveCount(2);
      await expect(view(page).locator('.favorites-toast')).toBeVisible();
    });

    test('the row menu moves a favorite to another group, and the move survives a reload', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      await row.getByRole('button', { name: 'Actions for Queue' }).click();
      await row.getByRole('menuitem', { name: 'Move to group…' }).click();

      // The current group is checked, and Ungrouped is the last group offered.
      await expect(row.getByRole('menuitemradio')).toHaveText([
        '✓Application integration',
        'Framework',
        'Ungrouped',
      ]);
      await expect(
        row.getByRole('menuitemradio', { name: 'Application integration' }),
      ).toHaveAttribute('aria-checked', 'true');
      await row.getByRole('menuitemradio', { name: 'Framework' }).click();

      await expect(view(page).locator('.favorites-group-count')).toHaveText(['(1)', '(2)']);
      await page.reload();
      await expect(view(page).locator('.favorites-group-count')).toHaveText(['(1)', '(2)']);
      expect(await stored(page, FAVORITES_KEY)).toEqual([
        { path: STARRED[0].path, title: 'Topic', group: 'Application integration' },
        { path: STARRED[1].path, title: 'Queue', group: 'Framework' },
        { path: STARRED[2].path, title: 'Construct', group: 'Framework' },
      ]);
    });

    test('New group creates an empty group that survives a reload, and a duplicate name is refused', async ({ page }) => {
      await openView(page);
      await view(page).getByRole('button', { name: 'New group' }).click();
      const field = view(page).getByRole('textbox', { name: 'New group name' });
      await field.fill('Framework');
      await field.press('Enter');
      await expect(view(page).locator('.favorites-name-error')).toHaveText(
        'A group named “Framework” already exists.',
      );

      await field.fill('Mine');
      await field.press('Enter');
      await expect(view(page).locator('.favorites-group-name')).toHaveText([
        'Application integration',
        'Framework',
        'Mine',
      ]);
      await expect(view(page).locator('.favorites-group-empty').last()).toHaveText(
        'No favorites in this group.',
      );
      expect(await stored(page, GROUPS_KEY)).toEqual(['Mine']);

      await page.reload();
      await expect(view(page).locator('.favorites-group-name')).toContainText(['Mine']);
    });

    test('renaming a map group keeps a later page from that service in the new name', async ({ page }) => {
      await openView(page);
      const heading = view(page).locator('.favorites-group').first();
      await heading.hover();
      await heading
        .getByRole('button', { name: 'Actions for group Application integration' })
        .click();
      await heading.getByRole('menuitem', { name: 'Rename' }).click();
      const field = view(page).getByRole('textbox', { name: 'Group name' });
      await expect(field).toHaveValue('Application integration');
      await field.fill('Messaging');
      await field.press('Enter');

      await expect(view(page).locator('.favorites-group-name')).toHaveText([
        'Framework',
        'Messaging',
      ]);
      expect(await stored(page, ALIASES_KEY)).toEqual({
        'Application integration': 'Messaging',
      });

      // A page the map puts in the renamed group joins the reader's name.
      await page.goto(SQS_OVERVIEW_PAGE);
      await page.locator('.favorite-star-button').click();
      await page.goto(QUEUE_PAGE);
      await expect(
        page.getByRole('list', { name: 'Messaging' }).locator('.favorites-link'),
      ).toHaveCount(3);
    });

    test('deleting a group moves its favorites to Ungrouped, and Undo brings the group back', async ({ page }) => {
      await openView(page);
      const group = view(page).locator('.favorites-group').first();
      await group.hover();
      await group
        .getByRole('button', { name: 'Actions for group Application integration' })
        .click();
      await group.getByRole('menuitem', { name: 'Delete group' }).click();

      const toast = view(page).locator('.favorites-toast');
      await expect(toast).toHaveText(
        /Deleted group “Application integration”\. 2 favorites moved to Ungrouped\./,
      );
      await expect(view(page).locator('.favorites-group-name')).toHaveText([
        'Framework',
        'Ungrouped',
      ]);

      await toast.getByRole('button', { name: 'Undo' }).click();
      await expect(view(page).locator('.favorites-group-name')).toHaveText([
        'Application integration',
        'Framework',
      ]);
    });

    test('a group folds and the choice is saved, with the count still on the heading', async ({ page }) => {
      await openView(page);
      const toggle = view(page).locator('.favorites-group-toggle').first();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('list', { name: 'Application integration' })).toBeHidden();
      await expect(view(page).locator('.favorites-group-count').first()).toHaveText('(2)');
      expect(await stored(page, COLLAPSED_KEY)).toEqual(['Application integration']);

      await page.reload();
      await expect(view(page).locator('.favorites-group-toggle').first()).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    test('the keyboard removes a focused row and Ctrl+Z takes the Undo back', async ({ page }) => {
      await openView(page);
      await view(page).locator('.favorites-link').first().focus();
      await page.keyboard.press('Delete');
      await expect(view(page).locator('.favorites-toast')).toBeVisible();
      await expect(view(page).locator('.favorites-link')).toHaveCount(2);

      await page.keyboard.press('Control+z');
      await expect(view(page).locator('.favorites-link')).toHaveCount(3);
      await expect(view(page).locator('.favorites-toast')).toHaveCount(0);
    });

    test('the Undo offer expires after eight seconds, and holds while the pointer or focus is on it', async ({
      page,
    }) => {
      await page.clock.install();
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      await row.getByRole('button', { name: 'Remove Queue from Favorites' }).click();
      const toast = view(page).locator('.favorites-toast');
      await expect(toast).toBeVisible();

      // Held while the pointer is over it.
      await toast.hover();
      await page.clock.runFor(9000);
      await expect(toast).toBeVisible();

      // A keyboard user on Undo keeps it, and a mouse leaving the toast must
      // not resume the timer under them.
      await toast.getByRole('button', { name: 'Undo' }).focus();
      await page.mouse.move(5, 5);
      await page.clock.runFor(9000);
      await expect(toast).toBeVisible();
      await expect(toast.getByRole('button', { name: 'Undo' })).toBeFocused();

      // With neither hold left, it goes after its eight seconds.
      await view(page).locator('.favorites-static-heading').click();
      await page.clock.runFor(7000);
      await expect(toast).toBeVisible();
      await page.clock.runFor(2000);
      await expect(toast).toHaveCount(0);
      // Expiry only drops the offer: the removal stands.
      await expect(view(page).locator('.favorites-link')).toHaveCount(2);
    });

    test('a click outside an open menu closes it', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      const actions = row.getByRole('button', { name: 'Actions for Queue' });
      await actions.click();
      await expect(row.getByRole('menu')).toBeVisible();

      await view(page).locator('.favorites-static-heading').click();
      await expect(row.getByRole('menu')).toHaveCount(0);
      await expect(actions).toHaveAttribute('aria-expanded', 'false');
    });

    test('a menu with no room below it opens upwards', async ({ page }) => {
      // A short viewport, so the last row sits past the bottom of the sidebar
      // and a menu under it would open out of sight. Opened from the keyboard:
      // hovering a row down there scrolls the sidebar and takes the button out
      // from under the pointer.
      await page.setViewportSize({ width: 1280, height: 360 });
      await openView(page, [
        ...STARRED,
        { path: '/v2/docs/aws-cdk-lib.aws_sqs.QueuePolicy', title: 'QueuePolicy' },
        { path: '/v2/docs/constructs.IConstruct', title: 'IConstruct' },
        { path: '/v2/docs/aws-cdk-lib.aws_scn.Thing', title: 'Thing' },
      ]);
      const row = view(page).locator('.favorites-item').last();
      await row.getByRole('button', { name: /^Actions for / }).focus();
      await page.keyboard.press('ArrowDown');
      const menu = row.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveClass(/favorites-menu-above/);

      const rowBox = (await row.boundingBox())!;
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(rowBox.y + 2);
    });

    test('a tall menu with no room above it stays below its button', async ({ page }) => {
      // A short viewport again, but opened from the first row, where the room
      // above is the smaller side. The group list is taller than either side,
      // so flipping it up would put its last items above the top of the
      // sidebar, which no amount of scrolling reaches.
      await page.setViewportSize({ width: 1280, height: 360 });
      await openView(page, [
        { path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue', title: 'Queue', group: 'Queues' },
        { path: '/v2/docs/aws-cdk-lib.aws_sns.Topic', title: 'Topic', group: 'Topics' },
        { path: '/v2/docs/constructs.Construct', title: 'Construct', group: 'Bases' },
        { path: '/v2/docs/aws-cdk-lib.aws_s3.Bucket', title: 'Bucket', group: 'Buckets' },
        { path: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function', group: 'Code' },
        { path: '/v2/docs/aws-cdk-lib.aws_iam.Role', title: 'Role', group: 'Access' },
      ]);
      const row = view(page).locator('.favorites-item').first();
      await row.getByRole('button', { name: /^Actions for / }).focus();
      await page.keyboard.press('ArrowDown');
      await row.getByRole('menuitem', { name: 'Move to group…' }).click();
      const menu = row.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu).not.toHaveClass(/favorites-menu-above/);

      const sidebarTop = (await page.locator('.VPSidebar').boundingBox())!.y;
      expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(sidebarTop);
    });

    test('the toast shows the Undo shortcut and names it on the button', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      await row.hover();
      await row.getByRole('button', { name: /^Remove/ }).click();

      const toast = view(page).locator('.favorites-toast');
      await expect(toast).toBeVisible();
      await expect(toast.locator('.favorites-toast-key')).toHaveText('Ctrl+Z');
      await expect(toast.getByRole('button', { name: 'Undo' })).toHaveAttribute(
        'aria-keyshortcuts',
        'Control+Z Meta+Z',
      );
      // Hidden from a screen reader, which hears the shortcut from the button.
      await expect(toast.locator('.favorites-toast-key')).toHaveAttribute('aria-hidden', 'true');
    });

    test('the row menu opens from the keyboard and Escape returns focus to its button', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      const actions = row.getByRole('button', { name: 'Actions for Queue' });
      await actions.focus();
      await page.keyboard.press('ArrowDown');
      await expect(row.getByRole('menuitem', { name: 'Move to group…' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(row.getByRole('menuitem', { name: 'Remove from Favorites' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(actions).toBeFocused();
      await expect(actions).toHaveAttribute('aria-expanded', 'false');
    });

    test('the row buttons stay out of sight until the row is hovered or focused', async ({ page }) => {
      await openView(page);
      const row = view(page).locator('.favorites-item').first();
      const actions = row.getByRole('button', { name: 'Actions for Queue' });
      await expect(actions).toHaveCSS('opacity', '0');
      await row.hover();
      await expect(actions).toHaveCSS('opacity', '1');
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 375, height: 760 } });

    test('every row keeps its ⋯ button, loses the x, and the menu removes', async ({ page }) => {
      await openView(page);
      // The sidebar is a drawer here: the local nav's Menu opens it, and the
      // Views button inside it unfolds the rail.
      await page.locator('.VPLocalNav button.menu').click();
      await page.getByRole('button', { name: /^Views/ }).click();
      await page.getByRole('navigation', { name: 'Sidebar views' })
        .getByRole('button', { name: 'Favorites' })
        .click();

      const row = view(page).locator('.favorites-item').first();
      const actions = row.getByRole('button', { name: 'Actions for Queue' });
      // Always visible here: there is no hover on a touch screen.
      await expect(actions).toHaveCSS('opacity', '1');
      await expect(row.getByRole('button', { name: /^Remove/ })).toBeHidden();
      const box = (await actions.boundingBox())!;
      expect(box.height).toBeCloseTo(28, 0);
      // The touch area comes from an overlay, so it cannot be read from the
      // box. It matches the row's own 40px: a 44px area would reach into the
      // rows either side, and the later one in the DOM would take that band,
      // so a finger at the edge of one row would open the next row's menu.
      expect(
        parseFloat(
          await actions.evaluate((el) => getComputedStyle(el, '::before').height),
        ),
      ).toBeGreaterThanOrEqual(40);

      await actions.click();
      await expect(row.getByRole('menuitem', { name: 'Remove from Favorites' })).toBeVisible();
      await row.getByRole('menuitem', { name: 'Remove from Favorites' }).click();
      await expect(view(page).locator('.favorites-link')).toHaveCount(2);
      // Using a menu does not fold the drawer away under the reader.
      await expect(view(page).locator('.favorites-toast')).toBeVisible();
    });

    test('Escape closes a menu or a name field and leaves the drawer open', async ({ page }) => {
      await openView(page);
      await page.locator('.VPLocalNav button.menu').click();
      const sidebar = page.locator('.VPSidebar');
      await expect(sidebar).toHaveClass(/open/);

      const row = view(page).locator('.favorites-item').first();
      const actions = row.getByRole('button', { name: 'Actions for Queue' });
      await actions.click();
      await expect(row.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(row.getByRole('menu')).toHaveCount(0);
      await expect(sidebar).toHaveClass(/open/);

      await view(page).getByRole('button', { name: 'New group' }).click();
      const field = view(page).getByRole('textbox', { name: 'New group name' });
      await expect(field).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(field).toHaveCount(0);
      await expect(sidebar).toHaveClass(/open/);

      // An Escape the view did not use still closes the drawer.
      await expect(view(page).getByRole('button', { name: 'New group' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(sidebar).not.toHaveClass(/open/);
    });

    test('an Escape whose release never arrives does not swallow the next one', async ({ page }) => {
      await openView(page);
      await page.locator('.VPLocalNav button.menu').click();
      const sidebar = page.locator('.VPSidebar');
      const row = view(page).locator('.favorites-item').first();
      await row.getByRole('button', { name: 'Actions for Queue' }).click();
      await expect(row.getByRole('menu')).toBeVisible();

      // The window loses focus after the press, so the release the view was
      // waiting for never arrives.
      await page.keyboard.down('Escape');
      await expect(row.getByRole('menu')).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(sidebar).toHaveClass(/open/);

      // The reader's next Escape is their own, with nothing open to close.
      await page.keyboard.press('Escape');
      await expect(sidebar).not.toHaveClass(/open/);
    });

    test('a menu too tall for the room above stays below, where scrolling reaches it', async ({ page }) => {
      await openView(page, [
        { path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue', title: 'Queue', group: 'Queues' },
        { path: '/v2/docs/aws-cdk-lib.aws_sns.Topic', title: 'Topic', group: 'Topics' },
        { path: '/v2/docs/constructs.Construct', title: 'Construct', group: 'Bases' },
        { path: '/v2/docs/aws-cdk-lib.aws_s3.Bucket', title: 'Bucket', group: 'Buckets' },
        { path: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function', group: 'Code' },
        { path: '/v2/docs/aws-cdk-lib.aws_iam.Role', title: 'Role', group: 'Access' },
      ]);
      await page.locator('.VPLocalNav button.menu').click();

      const row = view(page).locator('.favorites-item').last();
      await row.getByRole('button', { name: /^Actions for / }).click();
      await row.getByRole('menuitem', { name: 'Move to group…' }).click();
      const menu = row.getByRole('menu');
      await expect(menu).toBeVisible();

      // Whichever way it opened, every item of it must be inside the sidebar's
      // scrollable content: a scroller cannot reach above its own top.
      const sidebar = page.locator('.VPSidebar');
      const sidebarTop = (await sidebar.boundingBox())!.y;
      const scrollTop = await sidebar.evaluate((el) => el.scrollTop);
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.y - sidebarTop + scrollTop).toBeGreaterThanOrEqual(0);
      expect(menuBox.height).toBeGreaterThan((await sidebar.boundingBox())!.height / 3);
    });

    test('a long title still leaves Undo inside the drawer', async ({ page }) => {
      await openView(page, [
        {
          path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue',
          title: 'ApplicationLoadBalancedFargateServiceWithAnEvenLongerName',
        },
      ]);
      await page.locator('.VPLocalNav button.menu').click();

      const row = view(page).locator('.favorites-item').first();
      await row.getByRole('button', { name: /^Actions for / }).click();
      await row.getByRole('menuitem', { name: 'Remove from Favorites' }).click();

      const undo = view(page).getByRole('button', { name: 'Undo' });
      await expect(undo).toBeVisible();
      const sidebarBox = (await page.locator('.VPSidebar').boundingBox())!;
      const undoBox = (await undo.boundingBox())!;
      expect(undoBox.x + undoBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
      expect(undoBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
    });
  });
});
