import { expect, test } from '@playwright/test';
import { NESTED_TYPE_PAGE, QUEUE_PAGE, SQS_OVERVIEW_PAGE } from './fixture.js';

/**
 * The breadcrumb reads as a chevron-separated trail but must copy as the
 * type's real FQN. Only a browser can answer this: the separator and its
 * spacing are drawn in CSS over a dot collapsed to no size, and no unit test
 * on the emitted markdown can tell what a selection picks up.
 */
test.describe('breadcrumb copies as the FQN', () => {
  /** Select the trail exactly as a reader dragging across it would, and read what would be copied. */
  const selectTrail = (page: import('@playwright/test').Page): Promise<string> =>
    page.evaluate(() => {
      const trail = document.querySelector('.breadcrumb-trail');
      if (!trail) {
        throw new Error('no .breadcrumb-trail on the page');
      }
      const range = document.createRange();
      range.selectNodeContents(trail);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });

  test('a type page trail copies as the dotted FQN with no spaces and no chevrons', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.type-breadcrumb')).toBeVisible();

    expect(await selectTrail(page)).toBe('aws-cdk-lib.aws_sqs.Queue');
  });

  test('the visible trail is spaced and chevroned even though the copied text is not', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    // The separator a reader sees is a chevron drawn on each segment, and the
    // gap around it is that chevron's margin. Neither is a character, so the
    // text itself stays a tight dotted FQN.
    const chevron = await page.locator('.type-breadcrumb a').first().evaluate((el) => {
      const style = getComputedStyle(el, '::after');
      return {
        content: style.content,
        width: parseFloat(style.width),
        gap: parseFloat(style.marginLeft) + parseFloat(style.marginRight),
        border: style.borderTopWidth,
      };
    });
    expect(chevron.width).toBeGreaterThan(0);
    expect(chevron.gap).toBeGreaterThan(0);
    expect(parseFloat(chevron.border)).toBeGreaterThan(0);
    // Drawn from borders, so it contributes no text to a selection.
    expect(chevron.content).toMatch(/^("")|('')|(none)$/);

    const rendered = await page.locator('.breadcrumb-trail').innerText();
    expect(rendered).not.toContain('›');
    expect(rendered).not.toContain(' . ');
    expect(rendered).toBe('aws-cdk-lib.aws_sqs.Queue');
  });

  test('a join dot takes no space while a nested type keeps its own dot visible', async ({ page }) => {
    // A join dot is collapsed so the chevron reads as the separator; the dot
    // inside `CfnTopic.SubscriptionProperty` is part of the name and is not.
    await page.goto(NESTED_TYPE_PAGE);
    const joinWidth = await page.locator('.breadcrumb-dot').first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(joinWidth).toBeLessThan(1);
    const last = await page.locator('.breadcrumb-trail strong').evaluate((el) => {
      const style = getComputedStyle(el);
      return { text: (el.textContent ?? '').trim(), fontSize: parseFloat(style.fontSize) };
    });
    expect(last.text).toBe('CfnTopic.SubscriptionProperty');
    expect(last.fontSize).toBeGreaterThan(0);
  });

  test('a nested type keeps its enclosing type in the copied FQN', async ({ page }) => {
    // The one case where trail-join equalling the FQN is not obvious: the last
    // segment is `CfnTopic.SubscriptionProperty`, a single segment carrying a
    // dot, so the copied text must not lose the enclosing type.
    await page.goto(NESTED_TYPE_PAGE);

    expect(await selectTrail(page)).toBe('aws-cdk-lib.aws_sns.CfnTopic.SubscriptionProperty');
  });

  test('a submodule overview trail copies as the submodule id', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    expect(await selectTrail(page)).toBe('aws-cdk-lib.aws_sqs');
  });

  test('the favorite star does not end up in the copied text', async ({ page }) => {
    // An overview page is where the star still shares the breadcrumb bar as a
    // sibling of the trail, so a trail selection must not pick up its label.
    // A type page moved it to the chip row, out of the bar entirely.
    await page.goto(SQS_OVERVIEW_PAGE);
    await expect(page.locator('.type-breadcrumb .favorite-star-button')).toBeVisible();

    const copied = await selectTrail(page);
    expect(copied).toBe('aws-cdk-lib.aws_sqs');
    expect(copied.toLowerCase()).not.toContain('favorite');
  });

  test('a long trail wraps instead of overflowing a narrow viewport', async ({ page }) => {
    // Removing the spaces around the separators removed the trail's only break
    // opportunities, so without an explicit wrap a long FQN is one unbreakable
    // run that widens the page. No fixture page's trail is long enough to show
    // this, so the trail is substituted here.
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.breadcrumb-trail')).toBeVisible();

    for (const fqn of [
      'aws-cdk-lib.aws_elasticloadbalancingv2.ApplicationListenerCertificate',
      'aws-cdk-lib.interfaces.aws_apigatewayv2.IWebSocketApiRef',
      'aws-cdk-lib.aws_sagemaker.CfnModelBiasJobDefinition',
    ]) {
      const measured = await page.evaluate((text) => {
        const trail = document.querySelector('.breadcrumb-trail')!;
        trail.textContent = text;
        const bar = document.querySelector('.type-breadcrumb')!;
        const range = document.createRange();
        range.selectNodeContents(trail);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, copied: selection.toString() };
      }, fqn);

      expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);
      // A soft wrap must not put line breaks into what gets copied.
      expect(measured.copied).toBe(fqn);
    }
  });
  test('a narrow viewport wraps the real trail after a dot, and the copy is still the FQN', async ({ page }) => {
    // The dots carry no whitespace, so the `<wbr>` after each one is the only
    // break opportunity between segments; a break taken at it must land after
    // a dot and add nothing to the selection.
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(NESTED_TYPE_PAGE);
    await expect(page.locator('.breadcrumb-trail')).toBeVisible();

    const lines = await page.evaluate(() => {
      const trail = document.querySelector('.breadcrumb-trail')!;
      const range = document.createRange();
      const walker = document.createTreeWalker(trail, NodeFilter.SHOW_TEXT);
      const out: string[] = [];
      let lastTop: number | null = null;
      let line = '';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const { top } = range.getBoundingClientRect();
          if (lastTop !== null && Math.abs(top - lastTop) > 4) {
            out.push(line);
            line = '';
          }
          lastTop = top;
          line += text[i];
        }
      }
      out.push(line);
      return out;
    });

    expect(lines.length).toBeGreaterThan(1);
    // Every break lands after a dot, never inside a segment.
    for (const line of lines.slice(0, -1)) {
      expect(line).toMatch(/\.$/);
    }
    // The first line breaks at the last dot that fits, not the first.
    expect(lines[0].match(/\./g)!.length).toBeGreaterThan(1);
    expect(await selectTrail(page)).toBe('aws-cdk-lib.aws_sns.CfnTopic.SubscriptionProperty');
  });
});
