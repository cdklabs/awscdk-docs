import { expect, Page, test } from '@playwright/test';
import { CFN_QUEUE_PAGE } from './fixture.js';

// Member rows with a long type never widen the page. The type span is clipped
// with an ellipsis beside its name on desktop and wraps inside the column on a
// phone, even when it is one unbreakable token. Code blocks and signatures
// scroll inside their own box, which the overflow guard allows.
const CFN_TOPIC_PAGE = '/v2/docs/aws-cdk-lib.aws_sns.CfnTopic.html';
const CFN_SUBSCRIPTION_PAGE = '/v2/docs/aws-cdk-lib.aws_sns.CfnSubscription.html';

/**
 * Elements inside `.vp-doc` whose box extends past its right edge. Content that an ancestor inside the column
 * clips or scrolls (a code block, a signature, an ellipsized type) is measured by that ancestor; the permalink
 * gutter sits outside the column by design, and below 640px the stock theme bleeds code blocks to the viewport
 * edge, which the document-width check below still bounds.
 */
async function overflowing(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector('.vp-doc')!;
    const right = doc.getBoundingClientRect().right;
    const clipped = (el: HTMLElement) => {
      for (let p = el.parentElement; p && p !== doc; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') return true;
      }
      return false;
    };
    const out: string[] = [];
    for (const el of doc.querySelectorAll<HTMLElement>('*')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= right + 1) continue;
      if (el.closest('.header-anchor, .member-permalink') || el.matches('div[class*="language-"]') || clipped(el)) continue;
      out.push(`${el.tagName.toLowerCase()}.${el.className.toString().trim().split(/\s+/).join('.')} right=${Math.round(box.right)} > ${Math.round(right)}`);
    }
    return out;
  });
}

const CASES = [
  { path: CFN_TOPIC_PAGE, width: 1280 },
  { path: CFN_TOPIC_PAGE, width: 1920 },
  { path: CFN_SUBSCRIPTION_PAGE, width: 1280 },
  { path: `${CFN_TOPIC_PAGE}?lang=python`, width: 320 },
  { path: `${CFN_TOPIC_PAGE}?lang=python`, width: 375 },
  { path: CFN_TOPIC_PAGE, width: 768 },
  { path: CFN_QUEUE_PAGE, width: 375 },
];

test.describe('member type overflow', () => {
  for (const { path, width } of CASES) {
    test(`${path} stays inside the column at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.locator('.member-list .member-row').first()).toBeVisible();
      expect(await overflowing(page)).toEqual([]);
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.innerWidth);
    });
  }

  test('a clipped type keeps its name whole and ends in an ellipsis inside the column', async ({ page }) => {
    // The one CfnTopic row whose type is wider than the space beside its name.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(CFN_TOPIC_PAGE);
    const row = page.locator('.member-row#deliverystatuslogging');
    const variant = row.locator('.member-line > .lang-variant[data-lang="ts"]');
    const name = variant.locator('.member-name');
    const type = variant.locator('.member-type');
    const column = (await page.locator('.vp-doc').boundingBox())!;
    const nameBox = (await name.boundingBox())!;
    const typeBox = (await type.boundingBox())!;
    // The name is whole and the type starts after it on the same line.
    expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(typeBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
    expect(Math.abs(typeBox.y + typeBox.height - (nameBox.y + nameBox.height))).toBeLessThanOrEqual(2);
    // The type's own box ends inside the column and is the part that is cut, with its ellipsis.
    expect(typeBox.x + typeBox.width).toBeLessThanOrEqual(column.x + column.width + 1);
    expect(await type.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await type.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
    // The full type is still in the DOM for the tooltip and for copy.
    await expect(type).toHaveAttribute('title', /LoggingConfigProperty/);
  });

  test('on a phone the long type wraps inside the column instead of clipping', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${CFN_TOPIC_PAGE}?lang=python`);
    const type = page.locator('.member-row#deliverystatuslogging .lang-variant[data-lang="python"] .member-type');
    await expect(type).toBeVisible();
    const column = (await page.locator('.vp-doc').boundingBox())!;
    const box = (await type.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width + 1);
    // Wrapped onto more than one line: taller than a single line of its font.
    const lineHeight = await type.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(box.height).toBeGreaterThan(lineHeight * 1.5);
    expect(await type.evaluate((el) => getComputedStyle(el).overflow)).toBe('visible');
  });
});

// The fixture modules have no 60-character member name and no indented remark code block, so these two cases
// put that content into a real CfnTopic row and measure the same stylesheet on it.
test.describe('member rows with content the fixture lacks', () => {
  const LONG_NAME = 'attrMetadataConfigurationAnnotationTableConfigurationTableArn';

  test('a name wider than a phone column wraps inside it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(CFN_TOPIC_PAGE);
    const row = page.locator('.member-row#deliverystatuslogging');
    await row.locator('.lang-variant[data-lang="ts"] .member-name').evaluate((el, name) => {
      el.textContent = name;
    }, LONG_NAME);
    expect(await overflowing(page)).toEqual([]);
    const column = (await page.locator('.vp-doc').boundingBox())!;
    const name = (await row.locator('.lang-variant[data-lang="ts"] .member-name').boundingBox())!;
    expect(name.x + name.width).toBeLessThanOrEqual(column.x + column.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  });

  for (const width of [375, 1280]) {
    test(`an indented remark code block scrolls inside its own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(CFN_TOPIC_PAGE);
      const row = page.locator('.member-row#deliverystatuslogging');
      await row.evaluate((el) => {
        const extra = document.createElement('div');
        extra.className = 'member-extra';
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = 'const grant = bucket.grantPublicAccess();\ngrant.resourceStatement!.addCondition(\'IpAddress\', { \'aws:SourceIp\': \'54.240.143.0/24\' });';
        pre.appendChild(code);
        extra.appendChild(pre);
        el.appendChild(extra);
      });
      const pre = row.locator('pre:not([class])');
      expect(await pre.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
      expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(await overflowing(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
