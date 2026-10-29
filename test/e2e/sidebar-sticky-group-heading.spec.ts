import { expect, test, type Page } from '@playwright/test';
import { NESTED_TYPE_PAGE } from './fixture.js';

// Pinned group heading (docs/adr/2026-10-28-sidebar-sticky-group-heading.md):
// while a group's entries scroll, its own bold heading stays directly under
// the pinned header block, so a reader deep in a long list still sees which
// service or package it belongs to. Only the deepest such heading shows, kind
// groups (Others, Mixins, ...) and section titles never pin, and the pinned
// heading is the group's real button.
//
// The fixture entry `CfnTopic.SubscriptionProperty` sits at
// Services > SNS > Topic > Others in the service style. Visibility is asserted
// by hit-testing a painted point, as the sticky header specs do: a heading
// that is in the DOM but painted over does not count.
test.describe('pinned group heading', () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  async function open(page: Page, style: 'service' | 'package' = 'service') {
    await page.addInitScript((s) => {
      window.localStorage.setItem('cdk-docs-nav-style', s);
      window.localStorage.setItem('cdk-docs-consent', 'declined');
    }, style);
    await page.goto(NESTED_TYPE_PAGE);
    await expect(page.locator('.api-sidebar-link.active')).toBeVisible();
    // Let the on-load reveal settle.
    await page.waitForTimeout(600);
  }

  /** The `<li>` of the group whose own heading reads `name`, enclosing the active entry. */
  function groupSelector(name: string): string {
    return `li.api-sidebar-item:has(> button.api-sidebar-group > .api-sidebar-text:text-is("${name}")):has(.api-sidebar-link.active)`;
  }

  /** Scroll so the group's top edge sits `above` px above the header's bottom edge. */
  async function scrollGroup(page: Page, name: string, above: number) {
    const li = page.locator(groupSelector(name)).first();
    await li.evaluate((el, px) => {
      const aside = el.closest('aside.VPSidebar') as HTMLElement;
      const header = aside.querySelector('.sidebar-header') as HTMLElement;
      aside.scrollTop += el.getBoundingClientRect().top - header.getBoundingClientRect().bottom + px;
    }, above);
    await page.waitForTimeout(200);
  }

  /** Scroll so the group's bottom edge sits `below` px below the header's bottom edge. */
  async function scrollGroupEnd(page: Page, name: string, below: number) {
    const li = page.locator(groupSelector(name)).first();
    await li.evaluate((el, px) => {
      const aside = el.closest('aside.VPSidebar') as HTMLElement;
      const header = aside.querySelector('.sidebar-header') as HTMLElement;
      aside.scrollTop += el.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom - px;
    }, below);
    await page.waitForTimeout(200);
  }

  /** What is painted just under the header block, a few px down and at several points across. */
  async function band(page: Page) {
    return page.evaluate(() => {
      const header = document.querySelector('.sidebar-header') as HTMLElement;
      const box = header.getBoundingClientRect();
      const hits = [box.left + 40, box.left + 120, box.right - 40].map((x) => {
        const el = document.elementFromPoint(x, box.bottom + 6);
        return el?.closest('button,a')?.querySelector('.api-sidebar-text, .api-sidebar-name')?.textContent ?? null;
      });
      return { hits, headerBottom: box.bottom };
    });
  }

  /**
   * The group's heading button, as a locator that survives the group
   * collapsing (the active entry, which the group selector keys on, unmounts).
   */
  async function tagHeading(page: Page, name: string) {
    await page
      .locator(`${groupSelector(name)} > button.api-sidebar-group`)
      .first()
      .evaluate((el) => el.setAttribute('data-test-heading', ''));
    return page.locator('[data-test-heading]');
  }

  async function headingBox(page: Page, name: string) {
    return page
      .locator(`${groupSelector(name)} > button.api-sidebar-group`)
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
  }

  test('the deepest enclosing group heading pins under the header, by service', async ({ page }) => {
    await open(page);
    await scrollGroup(page, 'Topic', 120);
    const { hits, headerBottom } = await band(page);
    expect(hits).toEqual(['Topic', 'Topic', 'Topic']);
    const topic = await headingBox(page, 'Topic');
    expect(Math.abs(topic.top - headerBottom)).toBeLessThan(1);
    await expect(page.locator(groupSelector('Topic')).first()).toHaveAttribute('data-sticky-pinned', '');
    // The enclosing SNS heading is pinned at the same offset but hidden, so no
    // fragment of it shows anywhere around the pinned heading.
    const sns = page.locator(groupSelector('SNS')).first();
    await expect(sns).toHaveAttribute('data-sticky-covered', '');
    const snsBox = await headingBox(page, 'SNS');
    const snsPainted = await page.evaluate(
      (b) =>
        [b.top + 2, (b.top + b.bottom) / 2, b.bottom - 2].some((y) =>
          [b.left + 30, b.right - 30].some((x) => {
            const t = document.elementFromPoint(x, y)?.closest('button')?.querySelector('.api-sidebar-text')?.textContent;
            return t === 'SNS';
          }),
        ),
      snsBox,
    );
    expect(snsPainted).toBe(false);
  });

  test('no scrolling row paints over the pinned heading at any scroll offset', async ({ page }) => {
    // A row's caret rotates with `transform`, which makes it its own stacking
    // context; without a higher z-index on the pinned heading the caret of a
    // row sliding under it showed through. Sweep the offsets at which the
    // open-kind-group rows of Topic cross the band while Topic is still pinned.
    await open(page);
    for (let above = 96; above <= 132; above += 4) {
      await scrollGroup(page, 'Topic', above);
      const { hits } = await band(page);
      expect([above, hits]).toEqual([above, ['Topic', 'Topic', 'Topic']]);
    }
  });

  test('the pinned heading is the real button, with an opaque background', async ({ page }) => {
    await open(page);
    await scrollGroup(page, 'Topic', 120);
    // One button named Topic in the tree: no copy in the DOM or accessibility tree.
    const nav = page.getByRole('navigation', { name: 'API reference navigation' });
    await expect(nav.getByRole('button', { name: 'Topic', exact: true })).toHaveCount(1);
    const style = await page
      .locator(`${groupSelector('Topic')} > button.api-sidebar-group`)
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        const aside = getComputedStyle(el.closest('aside.VPSidebar')!);
        return { position: cs.position, bg: cs.backgroundColor, asideBg: aside.backgroundColor, expanded: el.getAttribute('aria-expanded') };
      });
    expect(style.position).toBe('sticky');
    expect(style.bg).toBe(style.asideBg);
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.expanded).toBe('true');
  });

  test('a kind group heading never pins', async ({ page }) => {
    await open(page);
    // Others is scrolled well above the line; Topic, which encloses it, pins.
    await scrollGroup(page, 'Others', 80);
    const { hits } = await band(page);
    expect(hits).toEqual(['Topic', 'Topic', 'Topic']);
    const others = await page
      .locator(`${groupSelector('Others')} > button.api-sidebar-group`)
      .first()
      .evaluate((el) => getComputedStyle(el).position);
    expect(others).not.toBe('sticky');
  });

  test('a section title never pins', async ({ page }) => {
    await open(page);
    const position = await page
      .locator('.api-sidebar-section-title')
      .first()
      .evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('static');
  });

  test('at the end of a group its heading is pushed up, never over the next row', async ({ page }) => {
    await open(page);
    // Topic's last 10px are under the line: its heading is being pushed away.
    await scrollGroupEnd(page, 'Topic', 10);
    const topic = await headingBox(page, 'Topic');
    const { headerBottom } = await band(page);
    expect(topic.top).toBeLessThan(headerBottom - 1);
    const next = await page
      .locator(groupSelector('Topic'))
      .first()
      .evaluate((el) => {
        const sibling = el.nextElementSibling?.firstElementChild as HTMLElement | null;
        return sibling ? sibling.getBoundingClientRect().top : null;
      });
    if (next !== null) expect(topic.bottom).toBeLessThanOrEqual(next + 0.5);
    // Being pushed away, Topic no longer covers SNS, which shows again behind it.
    await expect(page.locator(groupSelector('SNS')).first()).not.toHaveAttribute('data-sticky-covered', '');
    await expect(page.locator(groupSelector('SNS')).first()).toHaveAttribute('data-sticky-pinned', '');
    // Past the end, the next heading inside SNS takes over the band.
    await scrollGroupEnd(page, 'Topic', -40);
    const after = (await band(page)).hits[0];
    expect(after).not.toBe('Topic');
    const owner = await page.evaluate(() => {
      const header = document.querySelector('.sidebar-header') as HTMLElement;
      const box = header.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + 40, box.bottom + 6)?.closest('button.api-sidebar-group');
      const group = hit?.parentElement?.parentElement?.closest('li.api-sidebar-item');
      return {
        shown: hit?.querySelector('.api-sidebar-text')?.textContent,
        parent: group?.querySelector(':scope > .api-sidebar-group .api-sidebar-text')?.textContent,
      };
    });
    expect(owner).toEqual({ shown: after, parent: 'SNS' });
  });

  test('clicking the pinned heading collapses it and parks its row under the header', async ({ page }) => {
    await open(page);
    await scrollGroup(page, 'Topic', 150);
    const button = await tagHeading(page, 'Topic');
    // A real pointer click on the painted spot: locator.click() would first
    // scroll the button into view, which moves the tree before the click.
    const box = await headingBox(page, 'Topic');
    await page.mouse.click(box.left + 60, (box.top + box.bottom) / 2);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(200);
    const { headerBottom } = await band(page);
    const parked = await button.evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(parked - headerBottom)).toBeLessThan(1.5);
  });

  test('while the nav filter is active, collapsing the pinned heading also parks its row', async ({ page }) => {
    await open(page);
    // While filtering, the active entry's branch stays open and a fold lands in
    // the filter session; the park under the header still applies.
    await page.getByRole('textbox', { name: 'Filter navigation in the sidebar' }).fill('Topic');
    await expect(page.locator(groupSelector('Topic')).first()).toBeVisible();
    await page.waitForTimeout(300);
    await scrollGroup(page, 'Topic', 40);
    await expect(page.locator(groupSelector('Topic')).first()).toHaveAttribute('data-sticky-pinned', '');
    const button = await tagHeading(page, 'Topic');
    const box = await headingBox(page, 'Topic');
    await page.mouse.click(box.left + 60, (box.top + box.bottom) / 2);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(200);
    const { headerBottom } = await band(page);
    const parked = await button.evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(parked - headerBottom)).toBeLessThan(1.5);
  });

  test('keyboard: the pinned heading toggles with Enter and keeps a visible focus ring', async ({ page }) => {
    await open(page);
    await scrollGroup(page, 'Topic', 150);
    const button = await tagHeading(page, 'Topic');
    await expect(page.locator(groupSelector('Topic')).first()).toHaveAttribute('data-sticky-pinned', '');
    // A key press first, so the browser treats the focus as keyboard focus.
    await page.keyboard.press('Shift');
    await button.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    const ring = await button.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { offset: parseFloat(cs.outlineOffset), width: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
    });
    expect(ring.style).toBe('solid');
    // Drawn inside the button, so the header block cannot paint over it.
    expect(ring.offset + ring.width).toBeLessThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('a focused row is never hidden behind the pinned heading', async ({ page }) => {
    await open(page);
    await scrollGroup(page, 'Topic', 150);
    // A focusable row currently painted under the pinned heading.
    const row = await page.evaluate(() => {
      const header = document.querySelector('.sidebar-header') as HTMLElement;
      const y = header.getBoundingClientRect().bottom + 6;
      const rows = [...document.querySelectorAll<HTMLElement>('.api-sidebar-nav a, .api-sidebar-nav button')];
      const i = rows.findIndex((el) => {
        if (el.parentElement?.hasAttribute('data-sticky-pinned') || el.parentElement?.hasAttribute('data-sticky-covered')) return false;
        const r = el.getBoundingClientRect();
        return r.top <= y && r.bottom > y;
      });
      return i;
    });
    expect(row).toBeGreaterThanOrEqual(0);
    const link = page.locator('.api-sidebar-nav').locator('a, button').nth(row);
    await link.focus();
    await page.waitForTimeout(200);
    const pinnedBottom = await page.evaluate(() => {
      const pinned = document.querySelector('[data-sticky-pinned] > .api-sidebar-group') as HTMLElement | null;
      return pinned ? pinned.getBoundingClientRect().bottom : (document.querySelector('.sidebar-header') as HTMLElement).getBoundingClientRect().bottom;
    });
    const top = await link.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(pinnedBottom - 1);
  });

  test('Locate current page reveals the entry below the pinned heading', async ({ page }) => {
    await open(page);
    await page.locator('aside.VPSidebar').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Locate current page' }).click();
    await page.waitForTimeout(700);
    const active = await page.locator('.api-sidebar-link.active').evaluate((el) => el.getBoundingClientRect().top);
    const header = await band(page);
    const pinned = await page.evaluate(() => {
      const el = document.querySelector('[data-sticky-pinned] > .api-sidebar-group') as HTMLElement | null;
      return el ? el.getBoundingClientRect().bottom : null;
    });
    expect(active).toBeGreaterThanOrEqual((pinned ?? header.headerBottom) - 1);
  });

  test('by package, the module heading pins, not the category title', async ({ page }) => {
    await open(page, 'package');
    // The fixture nests the entry at CloudFormation Property Types (a section
    // title) > aws-cdk-lib.aws_sns (a package group) in this style.
    const chain = await page.evaluate(() => {
      const names: string[] = [];
      let li = document.querySelector('.api-sidebar-link.active')?.closest('li')?.parentElement?.closest('li');
      while (li) {
        const first = li.firstElementChild as HTMLElement;
        if (first.matches('button.api-sidebar-group') && !li.hasAttribute('data-kind-group')) {
          names.push(first.querySelector('.api-sidebar-text')!.textContent!);
        }
        li = li.parentElement?.closest('li');
      }
      return names;
    });
    expect(chain).toEqual(['aws-cdk-lib.aws_sns']);
    await scrollGroup(page, 'aws-cdk-lib.aws_sns', 200);
    const { hits } = await band(page);
    expect(hits).toEqual(['aws-cdk-lib.aws_sns', 'aws-cdk-lib.aws_sns', 'aws-cdk-lib.aws_sns']);
  });

  test('mobile drawer: the heading pins under the drawer header', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await open(page);
    await page.locator('.VPLocalNav button.menu').click();
    await expect(page.locator('aside.VPSidebar')).toHaveClass(/open/);
    await expect(page.locator('.api-sidebar-link.active')).toBeVisible();
    await page.waitForTimeout(400);
    await scrollGroup(page, 'Topic', 120);
    const { hits } = await band(page);
    expect(hits[0]).toBe('Topic');
  });
});
