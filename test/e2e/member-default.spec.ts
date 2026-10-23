import { expect, test } from '@playwright/test';
import { QUEUE_PROPS_PAGE } from './fixture.js';

// Value defaults in collapsed property rows. The emitter only puts a single
// token within its inline budget in the header, so the row promises to show
// that value in full. `FifoThroughputLimit.PER_QUEUE` on the QueueProps page is
// the probe: it fits the budget but is longer than a narrow header clamp.
//
// Geometry is the honest gate: the markup carries the full text either way,
// and only the browser can say whether any of it is clipped.

const PROBE = 'FifoThroughputLimit.PER_QUEUE';

interface DefaultMetric {
  readonly text: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly right: number;
  readonly lineRight: number;
}

async function defaultMetrics(page: import('@playwright/test').Page): Promise<DefaultMetric[]> {
  return page.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll('.member-list .member-default'))) {
      const box = el.getBoundingClientRect();
      // Hidden rows and language variants have no box; only shown values count.
      if (box.width === 0) {
        continue;
      }
      const line = el.closest('.member-line')!.getBoundingClientRect();
      out.push({
        text: (el.textContent ?? '').trim(),
        scrollWidth: (el as HTMLElement).scrollWidth,
        clientWidth: (el as HTMLElement).clientWidth,
        right: box.right,
        lineRight: line.right,
      });
    }
    return out;
  });
}

test.describe('value defaults in collapsed property rows', () => {
  // Desktop, a narrow window still above the 640px stacking breakpoint, and a
  // stacked phone-width row.
  for (const width of [1280, 700, 500]) {
    test(`no value default is clipped at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(QUEUE_PROPS_PAGE);

      const defaults = await defaultMetrics(page);
      // If the probe is missing, the fixture changed and this spec measures
      // nothing, which must fail rather than pass.
      expect(defaults.map((d) => d.text), `no row rendered the ${PROBE} default`)
        .toContain(`= ${PROBE}`);
      for (const d of defaults) {
        expect(d.scrollWidth, `default clipped: ${d.text}`).toBeLessThanOrEqual(d.clientWidth);
        expect(d.right, `default ran past its row: ${d.text}`).toBeLessThanOrEqual(d.lineRight + 1);
      }
    });
  }
});
