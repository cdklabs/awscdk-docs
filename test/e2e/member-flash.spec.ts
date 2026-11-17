import { expect, test } from '@playwright/test';
import { IQUEUE_PAGE, QUEUE_PAGE, QUEUE_PROPS_PAGE } from './fixture.js';

// A jump to a member row marks it with a flash that fades out, so a reader
// does not have to look for the row the page scrolled to. `:target` alone
// cannot do this: VitePress handles in-page links with pushState and its own
// scroll, which leaves `:target` unchanged.

const FLASH = 'member-row-flash';
const FIFO = '#props-queueprops-fifo';
const RETENTION = '#props-queueprops-retentionperiod';
const OUTLINE_LINK = (hash: string) => `.VPDocAsideOutline a.outline-link[href="${hash}"]`;

/** Count every start of the flash animation, from before hydration so a load with a hash is counted too. */
async function countFlashStarts(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { flashStarts: number; flashTargets: Element[] };
    w.flashStarts = 0;
    w.flashTargets = [];
    addEventListener('animationstart', (e) => {
      if ((e as AnimationEvent).animationName === 'member-row-flash') {
        w.flashStarts += 1;
        // The row that faded: one on an outgoing page is detached once that page is gone.
        w.flashTargets.push(e.target as Element);
      }
    }, true);
  });
}

async function flashStarts(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { flashStarts: number }).flashStarts);
}

/** The row's running animations, by name. */
async function animations(page: import('@playwright/test').Page, hash: string): Promise<string[]> {
  return page.locator(`.member-row${hash}`).evaluate((el) =>
    el.getAnimations().map((a) => (a as CSSAnimation).animationName),
  );
}

test.describe('a jump to a member row flashes it', () => {
  test('an outline click marks the row and the mark is gone after the fade', async ({ page }) => {
    // The jump reaches the module through more than one event, and must start one fade.
    await countFlashStarts(page);
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(page).toHaveURL(new RegExp(`${FIFO}$`));

    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    expect(await animations(page, FIFO)).toEqual(['member-row-flash']);
    // The class goes with the animation's end, 1.5s after the click.
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`), { timeout: 3000 });
    expect(await animations(page, FIFO)).toEqual([]);
    expect(await flashStarts(page)).toBe(1);
  });

  test('the flash starts at the flash color and ends at the row background', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const row = page.locator(`.member-row${FIFO}`);
    // Pause the animation at its first frame to read the start color.
    const colors = await page.evaluate(async (hash) => {
      const el = document.querySelector<HTMLElement>(`.member-row${hash}`)!;
      const token = getComputedStyle(document.documentElement).getPropertyValue('--api-c-flash').trim();
      // Resolve the token through an element so the comparison is rgb to rgb.
      const probe = document.createElement('div');
      probe.style.backgroundColor = token;
      document.body.append(probe);
      const flashRgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vp-c-brand-1').trim();
      document.body.append(probe);
      const brandRgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const resting = getComputedStyle(el);
      const restingBg = resting.backgroundColor;
      const restingOutline = resting.outlineStyle;
      el.classList.add('member-row-flash');
      const anim = el.getAnimations()[0];
      anim.pause();
      anim.currentTime = 0;
      const atStart = getComputedStyle(el);
      const start = { bg: atStart.backgroundColor, outline: atStart.outlineColor, style: atStart.outlineStyle, offset: atStart.outlineOffset };
      anim.currentTime = 1500;
      const atEnd = getComputedStyle(el);
      const end = { bg: atEnd.backgroundColor, outline: atEnd.outlineColor };
      anim.cancel();
      el.classList.remove('member-row-flash');
      return { flashRgb, brandRgb, restingBg, restingOutline, start, end };
    }, FIFO);
    expect(colors.start.bg).toBe(colors.flashRgb);
    // The background alone is pale, so a dashed brand outline fades with it: the
    // cue a reader with low contrast sensitivity can tell from the page.
    expect(colors.start.outline).toBe(colors.brandRgb);
    expect(colors.start.style).toBe('dashed');
    expect(colors.start.offset).toBe('2px');
    expect(colors.restingOutline).toBe('none');
    // Ending at the row's own background and a transparent outline means nothing snaps when the class goes.
    expect(colors.end.bg).toBe(colors.restingBg);
    expect(colors.end.outline).toBe('rgba(0, 0, 0, 0)');
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: every text color on a flashed row keeps AA at the start of the fade`, async ({ page }) => {
      await page.addInitScript((theme) => window.localStorage.setItem('vitepress-theme-appearance', theme), scheme);
      await page.goto(QUEUE_PAGE);
      await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      // The row renders text-1 (name), text-2 (summary), the type link, a brand link and a type parameter in a
      // signature when it has one; every distinct computed color in the member list is measured, so an element
      // the fixture lacks is covered by any row that has it.
      const pairs = await page.evaluate(() => {
        const list = document.querySelector('.member-list')!;
        const flash = getComputedStyle(document.documentElement).getPropertyValue('--api-c-flash').trim();
        const probe = document.createElement('div');
        probe.style.backgroundColor = flash;
        document.body.append(probe);
        const flashRgb = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const colors = new Set<string>();
        for (const el of list.querySelectorAll<HTMLElement>('.member-line *, .member-summary, .member-summary *')) {
          if (el.getBoundingClientRect().width > 0 && (el.textContent ?? '').trim()) {
            colors.add(getComputedStyle(el).color);
          }
        }
        return { flashRgb, colors: [...colors] };
      });
      const channels = (rgb: string) => rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (rgb: string) => {
        const [r, g, b] = channels(rgb).map((c) => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      // The token must resolve to an opaque color; an undefined one probes as transparent and proves nothing.
      expect(pairs.flashRgb).toMatch(/^rgb\(/);
      const bg = luminance(pairs.flashRgb);
      expect(pairs.colors.length).toBeGreaterThanOrEqual(3);
      for (const color of pairs.colors) {
        const fg = luminance(color);
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        expect([scheme, color, ratio >= 4.5]).toEqual([scheme, color, true]);
      }
    });
  }

  test('a second jump during the fade moves the mark to the new row', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.locator(OUTLINE_LINK(RETENTION)).click();
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    // Within 1s: the fade's own end at 1.5s must not be what clears the first row.
    await expect(page.locator(`.member-row${FIFO}`)).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`), { timeout: 1000 });
  });

  test('a repeat jump to the row the page is already at flashes it again', async ({ page }) => {
    // VitePress sends no hashchange for a link to the current hash; it only scrolls.
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`), { timeout: 3000 });
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(page).toHaveURL(new RegExp(`${FIFO}$`));
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('a member permalink and a page load with a hash flash too', async ({ page }) => {
    await countFlashStarts(page);
    await page.goto(`${QUEUE_PAGE}${FIFO}`);
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    // The route hook and the mount both see this hash; one fade.
    await expect.poll(() => flashStarts(page)).toBe(1);
    await page.waitForTimeout(400);
    expect(await flashStarts(page)).toBe(1);
    // The browser still sets `:target`; the stylesheet leaves it untinted once the module is installed.
    expect(await page.locator(`.member-row${FIFO}`).evaluate((el) => el.matches(':target'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.classList.contains('member-flash-ready'))).toBe(true);

    await page.locator(`.member-row${RETENTION} a.member-permalink`).click();
    await expect(page).toHaveURL(new RegExp(`${RETENTION}$`));
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('back and forward between hashes flash the row landed on, once each', async ({ page }) => {
    await countFlashStarts(page);
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await page.locator(OUTLINE_LINK(RETENTION)).click();
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await expect.poll(() => flashStarts(page)).toBe(2);
    // Back/forward lands on an entry with router state: its hashchange is left to the route hook.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${FIFO}$`));
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.waitForTimeout(400);
    expect(await flashStarts(page)).toBe(3);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${RETENTION}$`));
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.waitForTimeout(400);
    expect(await flashStarts(page)).toBe(4);
  });

  test('a link from another page that lands on a member flashes it', async ({ page }) => {
    await countFlashStarts(page);
    await page.goto(QUEUE_PROPS_PAGE);
    // The module is installed after VitePress's own link listener, so once its
    // marker is on `<html>` a click is intercepted and stays client-side.
    await expect(page.locator('html.member-flash-ready')).toHaveCount(1);
    await page.evaluate((href) => {
      (window as unknown as { spa: boolean }).spa = true;
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'jump';
      document.querySelector('.vp-doc')!.prepend(a);
    }, `${QUEUE_PAGE}${FIFO}`);
    await page.locator('.vp-doc a', { hasText: 'jump' }).click();
    await expect(page).toHaveURL(new RegExp(`${FIFO}$`));
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    // Still the same window: the route hook marked the row, not a fresh page load.
    expect(await page.evaluate(() => (window as unknown as { spa: boolean }).spa)).toBe(true);
    await page.waitForTimeout(400);
    expect(await flashStarts(page)).toBe(1);
  });

  test('back to a member on another page flashes it once, not the outgoing page', async ({ page }) => {
    // Queue and IQueue both have a row with this id, so the outgoing page could
    // be marked by the native hashchange before the returning page renders.
    const SHARED = '#encryptionmasterkey';
    await countFlashStarts(page);
    await page.goto(`${QUEUE_PAGE}${SHARED}`);
    await expect.poll(() => flashStarts(page)).toBe(1);
    await page.evaluate((href) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'away';
      document.querySelector('.vp-doc')!.prepend(a);
    }, IQUEUE_PAGE);
    await page.locator('.vp-doc a', { hasText: 'away' }).click();
    await expect(page).toHaveURL(new RegExp('IQueue\\.html$'));
    await expect(page.locator(`.member-row${SHARED}`)).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`Queue\\.html${SHARED}$`));
    await expect(page.locator(`.member-row${SHARED}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.waitForTimeout(400);
    // One fade, and it ran on a row still in the page: the outgoing page's row,
    // like the first load's, is detached by now.
    expect(await flashStarts(page)).toBe(2);
    expect(await page.evaluate(() => {
      const targets = (window as unknown as { flashTargets: Element[] }).flashTargets;
      return targets[targets.length - 1].isConnected;
    })).toBe(true);
  });

  test('a modified click or a link that opens elsewhere does not flash', async ({ page }) => {
    await countFlashStarts(page);
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`), { timeout: 3000 });
    expect(await flashStarts(page)).toBe(1);
    // A Ctrl/Cmd-click on the current hash opens a tab elsewhere; the row here stays quiet.
    const popup = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await page.locator(OUTLINE_LINK(FIFO)).click({ modifiers: ['ControlOrMeta'] });
    await (await popup)?.close();
    await page.waitForTimeout(400);
    expect(await flashStarts(page)).toBe(1);
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    // A same-hash link with a target opens elsewhere too.
    await page.evaluate((hash) => {
      const a = document.createElement('a');
      a.href = hash;
      a.target = '_blank';
      a.textContent = 'elsewhere';
      document.querySelector('.vp-doc')!.prepend(a);
    }, FIFO);
    const popup2 = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await page.locator('.vp-doc a', { hasText: 'elsewhere' }).click();
    await (await popup2)?.close();
    await page.waitForTimeout(400);
    expect(await flashStarts(page)).toBe(1);
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('a hash set by script, with no router state, flashes from the hashchange', async ({ page }) => {
    await countFlashStarts(page);
    await page.goto(QUEUE_PAGE);
    await page.evaluate((hash) => {
      location.hash = hash;
    }, RETENTION);
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.waitForTimeout(400);
    expect(await flashStarts(page)).toBe(1);
  });

  test('a jump to a heading marks nothing', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.locator('a.header-anchor').first().click();
    await expect(page.locator(`.${FLASH}`)).toHaveCount(0, { timeout: 1000 });
  });

  test('the mark is visual only: no attribute changes and the row keeps its size', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const row = page.locator(`.member-row${FIFO}`);
    const before = await row.evaluate((el) => ({
      attrs: [...el.attributes].map((a) => a.name).filter((n) => n !== 'class').sort(),
      height: el.getBoundingClientRect().height,
      width: el.getBoundingClientRect().width,
    }));
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    const after = await row.evaluate((el) => ({
      attrs: [...el.attributes].map((a) => a.name).filter((n) => n !== 'class').sort(),
      height: el.getBoundingClientRect().height,
      width: el.getBoundingClientRect().width,
    }));
    expect(after).toEqual(before);
    expect(before.attrs.some((n) => n.startsWith('aria-'))).toBe(false);
  });
});

test.describe('under forced colors', () => {
  test('the mark is an outline for as long as the fade', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    // Author backgrounds are dropped; the outline carries the mark, in the system
    // highlight color for the whole fade rather than the animated brand color.
    await expect(row).toHaveCSS('outline-style', 'dashed');
    await expect(row).toHaveCSS('outline-width', '2px');
    const highlight = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.outline = '2px solid Highlight';
      document.body.append(probe);
      const rgb = getComputedStyle(probe).outlineColor;
      probe.remove();
      return rgb;
    });
    await expect(row).toHaveCSS('outline-color', highlight);
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`), { timeout: 3000 });
    await expect(row).toHaveCSS('outline-style', 'none');
  });
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  /** The resolved flash color and brand color, rgb to rgb. */
  const marks = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const resolve = (token: string) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      document.body.append(probe);
      const rgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return rgb;
    };
    return { flash: resolve('--api-c-flash'), brand: resolve('--vp-c-brand-1') };
  });

  test('nothing animates and the row keeps a static mark until the next jump', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    expect(await animations(page, FIFO)).toEqual([]);
    const { flash, brand } = await marks(page);
    await expect(row).toHaveCSS('background-color', flash);
    // The outline is what a reader sees when backgrounds are faint or forced away.
    await expect(row).toHaveCSS('outline-style', 'dashed');
    await expect(row).toHaveCSS('outline-width', '2px');
    await expect(row).toHaveCSS('outline-color', brand);
    await expect(row).toHaveCSS('outline-offset', '2px');
    // Still marked well after the fade would have ended.
    await page.waitForTimeout(1800);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));

    await page.locator(OUTLINE_LINK(RETENTION)).click();
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await expect(row).toHaveCSS('outline-style', 'none');
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveCSS('background-color', flash);
  });

  test('the mark does not change the row size', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const row = page.locator(`.member-row${FIFO}`);
    const before = await row.boundingBox();
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    const after = await row.boundingBox();
    expect(after!.width).toBe(before!.width);
    expect(after!.height).toBe(before!.height);
  });

  test('after a load with a hash, a jump leaves only the new row marked', async ({ page }) => {
    // `:target` stays on the first-loaded row forever; its tint must not sit
    // beside the static mark, or two rows look landed on.
    await page.goto(`${QUEUE_PAGE}${FIFO}`);
    await page.locator(OUTLINE_LINK(RETENTION)).click();
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    const marked = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.props-table .member-row'));
      const plain = rows.find((r) => !r.matches(':target') && !r.classList.contains('member-row-flash'))!;
      const resting = getComputedStyle(plain).backgroundColor;
      return rows
        .filter((r) => getComputedStyle(r).backgroundColor !== resting || getComputedStyle(r).outlineStyle !== 'none')
        .map((r) => `#${r.id}`);
    });
    expect(marked).toEqual([RETENTION]);
  });

  test('the mark survives forced colors', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    // Author backgrounds are dropped under forced colors; the outline stays.
    await expect(row).toHaveCSS('outline-style', 'dashed');
    await expect(row).toHaveCSS('outline-width', '2px');
  });
});
