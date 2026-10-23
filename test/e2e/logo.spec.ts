import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// The navbar logo is one <img> whose dark-mode color comes from a CSS filter, so a cold load fetches the mark
// once. Asserted on the network and on rendered pixels, not on the markup alone.
test.describe('navbar logo: one asset for both color modes', () => {
  const logo = (page: import('@playwright/test').Page) => page.locator('.VPNavBarTitle img.logo');

  test('a cold load fetches one decorative logo image', async ({ page }) => {
    const logoRequests: string[] = [];
    page.on('request', (r) => {
      if (/aws-logo/.test(r.url())) {
        logoRequests.push(r.url());
      }
    });
    await page.goto(TOPIC_PAGE, { waitUntil: 'networkidle' });

    await expect(logo(page)).toHaveCount(1);
    await expect(logo(page)).toBeVisible();
    await expect(logo(page)).toHaveAttribute('alt', '');
    await expect(logo(page)).toHaveAttribute('src', /\/aws-logo-gray\.svg$/);
    expect(logoRequests).toHaveLength(1);
    expect(logoRequests[0]).toMatch(/\/aws-logo-gray\.svg$/);
    // A light/dark pair would have fetched the white variant here too, hidden or not.
    expect(logoRequests.some((u) => /white/.test(u))).toBe(false);
  });

  test('the mark is painted gray in light mode and white in dark mode, from the same file', async ({ page }) => {
    // Sample the rendered pixels rather than reading the filter back: a filter with the wrong output color
    // would still read as set. The mean opaque pixel is what a reader sees.
    const sample = () =>
      logo(page).evaluate(async (el) => {
        const img = el as HTMLImageElement;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.filter = getComputedStyle(img).filter;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        let sum = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 200) {
            opaque++;
            sum = [sum[0] + d[i], sum[1] + d[i + 1], sum[2] + d[i + 2]];
          }
        }
        return { opaque, mean: sum.map((v) => Math.round(v / opaque)), filter: getComputedStyle(img).filter };
      });

    await page.goto(TOPIC_PAGE);
    const light = await sample();
    expect(light.filter).toBe('none');
    expect(light.opaque).toBeGreaterThan(100);
    // The gray the SVG declares, #161d26.
    expect(light.mean).toEqual([22, 29, 38]);

    await page.evaluate(() => {
      window.localStorage.setItem('vitepress-theme-appearance', 'dark');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    const dark = await sample();
    expect(dark.filter).toBe('brightness(0) invert(1)');
    // Same file, same geometry: only the paint changes.
    expect(dark.opaque).toBe(light.opaque);
    expect(dark.mean).toEqual([255, 255, 255]);
  });
});
