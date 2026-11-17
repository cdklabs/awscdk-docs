import { expect, test } from '@playwright/test';
import { QUEUE_PAGE, QUEUE_PROPS_PAGE } from './fixture.js';

// A jump to a member row marks it with a flash that fades out, so a reader
// does not have to look for the row the page scrolled to. `:target` alone
// cannot do this: VitePress handles in-page links with pushState and its own
// scroll, which leaves `:target` unchanged.

const FLASH = 'member-row-flash';
const FIFO = '#props-queueprops-fifo';
const RETENTION = '#props-queueprops-retentionperiod';
const OUTLINE_LINK = (hash: string) => `.VPDocAsideOutline a.outline-link[href="${hash}"]`;

/** The row's running animations, by name. */
async function animations(page: import('@playwright/test').Page, hash: string): Promise<string[]> {
  return page.locator(`.member-row${hash}`).evaluate((el) =>
    el.getAnimations().map((a) => (a as CSSAnimation).animationName),
  );
}

test.describe('a jump to a member row flashes it', () => {
  test('an outline click marks the row and the mark is gone after the fade', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(page).toHaveURL(new RegExp(`${FIFO}$`));

    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    expect(await animations(page, FIFO)).toEqual(['member-row-flash']);
    // The class goes with the animation's end, 1.5s after the click.
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`), { timeout: 3000 });
    expect(await animations(page, FIFO)).toEqual([]);
  });

  test('the flash starts brand-soft and ends transparent', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const row = page.locator(`.member-row${FIFO}`);
    // Pause the animation at its first frame to read the start color.
    const colors = await page.evaluate(async (hash) => {
      const el = document.querySelector<HTMLElement>(`.member-row${hash}`)!;
      const brand = getComputedStyle(document.documentElement).getPropertyValue('--vp-c-brand-soft').trim();
      // Resolve the token through an element so the comparison is rgb to rgb.
      const probe = document.createElement('div');
      probe.style.backgroundColor = brand;
      document.body.append(probe);
      const brandRgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      el.classList.add('member-row-flash');
      const anim = el.getAnimations()[0];
      anim.pause();
      anim.currentTime = 0;
      const start = getComputedStyle(el).backgroundColor;
      anim.currentTime = 1500;
      const end = getComputedStyle(el).backgroundColor;
      anim.cancel();
      el.classList.remove('member-row-flash');
      return { brandRgb, start, end };
    }, FIFO);
    expect(colors.start).toBe(colors.brandRgb);
    expect(colors.end).toBe('rgba(0, 0, 0, 0)');
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('a second jump during the fade moves the mark to the new row', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.locator(OUTLINE_LINK(RETENTION)).click();
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await expect(page.locator(`.member-row${FIFO}`)).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('a member permalink and a page load with a hash flash too', async ({ page }) => {
    await page.goto(`${QUEUE_PAGE}${FIFO}`);
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    // The static tint still applies on a load with a hash.
    expect(await page.locator(`.member-row${FIFO}`).evaluate((el) => el.matches(':target'))).toBe(true);

    await page.locator(`.member-row${RETENTION} a.member-permalink`).click();
    await expect(page).toHaveURL(new RegExp(`${RETENTION}$`));
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('back and forward between hashes flash the row landed on', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await page.locator(OUTLINE_LINK(RETENTION)).click();
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${FIFO}$`));
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${RETENTION}$`));
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('a link from another page that lands on a member flashes it', async ({ page }) => {
    await page.goto(QUEUE_PROPS_PAGE);
    // A client-side navigation: the new page renders, then the landed row is marked.
    await page.evaluate((href) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'jump';
      document.querySelector('.vp-doc')!.prepend(a);
    }, `${QUEUE_PAGE}${FIFO}`);
    await page.locator('.vp-doc a', { hasText: 'jump' }).click();
    await expect(page).toHaveURL(new RegExp(`${FIFO}$`));
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
  });

  test('a jump to a heading marks nothing', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    await expect(page.locator(`.member-row${FIFO}`)).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await page.locator('a.header-anchor').first().click();
    await expect(page.locator(`.${FLASH}`)).toHaveCount(0);
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

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing animates and the row keeps a static tint until the next jump', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator(OUTLINE_LINK(FIFO)).click();
    const row = page.locator(`.member-row${FIFO}`);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    expect(await animations(page, FIFO)).toEqual([]);
    const tint = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vp-c-bg-soft').trim();
      document.body.append(probe);
      const rgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return rgb;
    });
    await expect(row).toHaveCSS('background-color', tint);
    // Still marked well after the fade would have ended.
    await page.waitForTimeout(1800);
    await expect(row).toHaveClass(new RegExp(`\\b${FLASH}\\b`));

    await page.locator(OUTLINE_LINK(RETENTION)).click();
    await expect(row).not.toHaveClass(new RegExp(`\\b${FLASH}\\b`));
    await expect(page.locator(`.member-row${RETENTION}`)).toHaveCSS('background-color', tint);
  });
});
