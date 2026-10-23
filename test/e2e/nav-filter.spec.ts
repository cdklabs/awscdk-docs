import { expect, test, type Page } from '@playwright/test';
import { apiSidebarAssetPath, TOPIC_PAGE } from './fixture.js';

// In-sidebar symbol filter: the filter input sits at
// the top of the sidebar and narrows the API sidebar tree IN PLACE — there is no popup listbox.
// Enter jumps to the best-ranked symbol from the lazily-fetched symbol index.
test.describe('in-sidebar symbol filter', () => {
  // ApiSidebar fetches the skeleton and the page's chunk on mount; wait for it.
  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  const filterInput = (page: Page) =>
    page.getByRole('textbox', { name: 'Filter API symbols in the sidebar' });

  test('typing narrows the API sidebar in place (no popup)', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const sidebar = page.locator('.api-sidebar');
    const input = filterInput(page);
    await expect(input).toBeVisible();

    // Baseline: the SNS-only "Topic" entry is present in the full tree.
    await expect(sidebar.getByText('Topic', { exact: true })).not.toHaveCount(0);

    await input.fill('Queue');

    // The tree is pruned to matching entries plus their ancestor groups
    // (forced open): a Queue entry is shown, the SNS-only "Topic" entry is
    // removed from the tree entirely.
    await expect(sidebar.getByText('Queue', { exact: true }).first()).toBeVisible();
    await expect(sidebar.getByText('Topic', { exact: true })).toHaveCount(0);

    // Narrowing happens in place: no popup listbox may appear.
    await expect(page.locator('#nav-filter-listbox')).toHaveCount(0);

    const hint = page.locator('.nav-filter-hint');
    await expect(hint).toContainText('Enter opens');
    await expect(hint).not.toContainText('Filtering sidebar');
  });

  test('a below-minimum query leaves the sidebar unfiltered and offers no jump', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const sidebar = page.locator('.api-sidebar');
    const input = filterInput(page);
    const before = await sidebar.getByText('Topic', { exact: true }).count();

    await input.fill('Q');

    await expect(sidebar.getByText('Topic', { exact: true })).toHaveCount(before);
    await expect(page.locator('.nav-filter-hint')).toBeEmpty();
    await expect(page.locator('.sidebar-jump-current')).toHaveCount(1);

    await input.fill('Qu');
    await expect(page.locator('.nav-filter-hint')).toContainText('Enter opens');
  });

  test('Enter keeps focus in the filter input', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const input = filterInput(page);
    await input.fill('Queue');
    await input.press('Enter');

    await expect(page).toHaveURL(/aws-cdk-lib\.aws_sqs\.Queue/);
    await expect(filterInput(page)).toBeFocused();
    await expect(filterInput(page)).toHaveValue('');
  });

  test('the filter sits below the pinned header top edge, clear of the navbar', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);
    await filterInput(page).focus();

    const gap = await page.evaluate(() => {
      const box = document.querySelector('.nav-filter-box')!.getBoundingClientRect();
      const header = document.querySelector('.sidebar-header')!.getBoundingClientRect();
      return box.top - header.top;
    });
    // The pinned header carries 8px of top padding on desktop so the focused
    // filter box's inset ring clears the navbar border it is pinned against.
    // The box therefore starts 8px below the header's box top, not flush with
    // it — a flush box (gap 0) is the crowded state this spacing fixes.
    expect(gap).toBe(8);
  });

  test('Enter jumps to the best-ranked symbol', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const input = filterInput(page);
    await input.fill('Queue');
    await input.press('Enter');

    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sqs\.Queue/);
    await expect(page.locator('h1').first()).toContainText('Queue');
  });

  test('an l1/l2/l3 term selects the construct of that level', async ({ page }) => {
    // The level term is a filter on the symbol index, not a substring of the name: `queue` alone is ambiguous
    // between the L2 `Queue` and the L1 `CfnQueue`, and the level term decides which one Enter resolves to.
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const input = filterInput(page);

    await input.fill('l2 queue');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sqs\.Queue/);

    await input.fill('l1 queue');
    await input.press('Enter');
    // Several services define a `CfnQueue`; they tie on rank and name, so the level is what this asserts.
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_\w+\.CfnQueue/);
  });

  test('a bare level term resolves to a construct of that level', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const input = filterInput(page);
    await input.fill('l3');
    await input.press('Enter');

    // Every L3 construct in the corpus lives in a `*_patterns` submodule, which is what makes the level
    // assertion possible from the URL alone.
    await expect(page).toHaveURL(/_patterns\./);
  });

  test('Enter prefers a stable module over an alpha one when both match equally', async ({ page }) => {
    // `function` matches the alpha module's `Function` and two aws-cdk-lib ones (CloudFront, Lambda) with the same
    // rank; the complete symbol index ships with the fixture even though none of the pages do, so the URL is the
    // assertion. Which of the two stable constructs wins is not part of this rule.
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const input = filterInput(page);
    await input.fill('function');
    await input.press('Enter');

    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_\w+\.Function/);
  });

  test('Enter pressed before the symbol index loads still jumps to the best match', async ({ page }) => {
    // Deterministically exercise the race that makes the spec above flaky:
    // the index is fetched lazily on first focus, so an Enter handler that
    // read the index synchronously would no-op or jump to the previously
    // highlighted symbol when Enter arrives before the fetch resolves. Delay
    // the index response so Enter is GUARANTEED to fire while the load is
    // still in flight; the handler must await the load and then rank the query
    // captured at press time.
    await page.route(`**${apiSidebarAssetPath('symbols')}`, async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ response });
    });

    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const input = filterInput(page);
    await input.fill('Queue');
    // The index fetch (kicked off by the focus from fill) is still pending
    // behind the 1.5s delay — this Enter lands mid-load by construction.
    await input.press('Enter');

    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sqs\.Queue/);
    await expect(page.locator('h1').first()).toContainText('Queue');
  });

  test('Escape clears the query and restores the full sidebar', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const sidebar = page.locator('.api-sidebar');
    const input = filterInput(page);

    await input.fill('Queue');
    await expect(sidebar.getByText('Topic', { exact: true })).toHaveCount(0);

    await input.press('Escape');
    await expect(input).toHaveValue('');
    // The SNS "Topic" entry is back in the tree once the filter is cleared.
    await expect(sidebar.getByText('Topic', { exact: true })).not.toHaveCount(0);
  });

  test('clear button appears with input, clears on click, and refocuses', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const sidebar = page.locator('.api-sidebar');
    const input = filterInput(page);
    const clearButton = page.getByRole('button', { name: 'Clear filter' });

    // Not rendered at all while the input is empty (v-if, not css-hidden).
    await expect(clearButton).toHaveCount(0);

    await input.fill('Queue');
    await expect(clearButton).toBeVisible();
    await expect(sidebar.getByText('Topic', { exact: true })).toHaveCount(0);

    await clearButton.click();

    // Query cleared, full sidebar restored, button gone, input refocused.
    await expect(input).toHaveValue('');
    await expect(sidebar.getByText('Topic', { exact: true })).not.toHaveCount(0);
    await expect(clearButton).toHaveCount(0);
    await expect(input).toBeFocused();
  });

  test('a query with no matches shows the empty state', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    await filterInput(page).fill('zzz-no-such-symbol');

    await expect(
      page.locator('.api-sidebar-status').filter({ hasText: 'No matching entries' }),
    ).toBeVisible();
  });

  test('whitespace-separated terms combine with AND, order-independent', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const sidebar = page.locator('.api-sidebar');
    const input = filterInput(page);

    // "sqs queue": the SQS section satisfies "sqs" and the Queue entry
    // satisfies "queue" — Queue stays, the SNS-only Topic is dropped.
    await input.fill('sqs queue');
    await expect(sidebar.getByText('Queue', { exact: true }).first()).toBeVisible();
    await expect(sidebar.getByText('Topic', { exact: true })).toHaveCount(0);

    // Same result set with the terms reversed.
    await input.fill('queue sqs');
    await expect(sidebar.getByText('Queue', { exact: true }).first()).toBeVisible();
    await expect(sidebar.getByText('Topic', { exact: true })).toHaveCount(0);

    // AND, not OR: terms matching only different services yield nothing.
    await input.fill('sns queue');
    await expect(
      page.locator('.api-sidebar-status').filter({ hasText: 'No matching entries' }),
    ).toBeVisible();
  });

  test('control is visually integrated with the theme search treatment', async ({ page }) => {
    // The filter was restructured from a bare input into a composite
    // control mirroring VitePress's own navbar search button: a flex
    // .nav-filter-box wrapping a decorative magnifier icon, the input,
    // and (while non-empty) the clear button, with the focus treatment
    // moved from the input to the box. Jest never renders the site, so
    // this structural/visual contract is asserted here (AGENTS.md rule
    // on interactive theme features).
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const box = page.locator('.nav-filter-box');
    const icon = box.locator('.nav-filter-icon');
    const input = filterInput(page);

    // The magnifier icon renders inside the box and is decorative only
    // (hidden from assistive tech — the input keeps the aria-label).
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('aria-hidden', 'true');

    // Resting state: the box border is transparent — the control reads
    // as a filled affordance, not an outlined bare input.
    await expect
      .poll(() => box.evaluate((el) => getComputedStyle(el).borderTopColor))
      .toBe('rgba(0, 0, 0, 0)');

    // Focusing the INPUT highlights the WHOLE box (:focus-within brand
    // border); what this rejects is the input carrying its own
    // border/outline while the box stays inert.
    await input.focus();
    await expect
      .poll(() => box.evaluate((el) => getComputedStyle(el).borderTopColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    await expect
      .poll(() => input.evaluate((el) => getComputedStyle(el).outlineStyle))
      .toBe('none');

    // The clear button mounts INSIDE the box (a flex sibling of the
    // input, no longer absolutely positioned over it) and still works
    // through the restructure.
    await input.fill('Queue');
    const clearButton = box.getByRole('button', { name: 'Clear filter' });
    await expect(clearButton).toBeVisible();
    await clearButton.click();
    await expect(input).toHaveValue('');
  });

  test('focus is visually distinct from hover, not just the same border', async ({ page }) => {
    // WCAG 1.4.11: hover and focus-within shared one 1px border-color
    // declaration, so the focused state and a passing pointer rendered
    // identically. Focus now also draws the theme's 2px inset outline.
    // Computed styles are the only honest way to assert this, so it lives
    // here rather than in Jest.
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const box = page.locator('.nav-filter-box');
    const input = filterInput(page);
    const outlineOf = () =>
      box.evaluate((el) => {
        const s = getComputedStyle(el);
        return `${s.outlineStyle} ${s.outlineWidth}`;
      });

    // Hovering brings up the brand border but NO outline.
    await box.hover();
    await expect.poll(() => box.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
    const hovered = await outlineOf();
    expect(hovered).toMatch(/^(none|solid 0px)/);

    // Focusing the input adds the 2px inset outline on top of it, so the
    // two states are no longer the same rendering.
    await input.focus();
    await expect.poll(outlineOf).toBe('solid 2px');
    await expect.poll(() => box.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe('-2px');
    expect(await outlineOf()).not.toBe(hovered);
  });

  // The sidebar is 320px, so a symbol name can be several times wider than the
  // row it is hinted in. The name has to give way on one line instead of
  // wrapping, because the row is reserved and the tree below it must not move.
  const LONG_QUERY = 'InstanceAccessControlAttribute';

  test('a long best-match name stays on one line and truncates with an ellipsis', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    await filterInput(page).fill(LONG_QUERY);

    const best = page.locator('.nav-filter-best');
    await expect(best).toContainText('InstanceAccessControlAttributeConfiguration');

    const box = await best.evaluate((el) => {
      const s = getComputedStyle(el);
      const lineHeight = parseFloat(s.lineHeight);
      return {
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        lines: Math.round(el.getBoundingClientRect().height / lineHeight),
        whiteSpace: s.whiteSpace,
        textOverflow: s.textOverflow,
      };
    });

    // The overflow is what makes the ellipsis observable rather than declared.
    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
    expect(box.lines).toBe(1);
    expect(box.whiteSpace).toBe('nowrap');
    expect(box.textOverflow).toBe('ellipsis');

    // The truncated text is unreadable on its own, so the full name has to
    // remain reachable.
    await expect(best).toHaveAttribute('title', await best.innerText());
  });

  test('the hint row does not grow when a long name is hinted', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    const rowHeight = () =>
      page.locator('.nav-filter-status').evaluate((el) => el.getBoundingClientRect().height);

    const input = filterInput(page);
    await input.fill('');
    const reserved = await rowHeight();

    await input.fill(LONG_QUERY);
    await expect(page.locator('.nav-filter-best')).toBeVisible();
    expect(await rowHeight()).toBe(reserved);
  });

  test('the key glyph is decorative and the key name reaches assistive technology', async ({
    page,
  }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);
    await filterInput(page).fill('Queue');

    // A screen reader must not announce the glyph as a stray character, so the
    // key is named in text and the drawing is hidden.
    await expect(page.locator('.nav-filter-key .glyph')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.nav-filter-hint')).toContainText('Enter opens');
  });
});
