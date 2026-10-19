import { expect, test } from '@playwright/test';
import { SQS_OVERVIEW_PAGE, TOPIC_PAGE } from './fixture.js';

// Agent-oriented Markdown twin of every generated page: the page advertises it in the footer and in
// `<head>`, the path is the page's own with `.md` for `.html`, and following it returns plain Markdown — asserted
// on the body, not merely on the anchor existing.
test.describe('agent-oriented Markdown twin', () => {
  const twinOf = (htmlPath: string) => htmlPath.replace(/\.html$/, '.md');

  test('the footer link and the alternate head link both name the .md twin of this page', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const link = page.locator('.page-footer-links .footer-link', { hasText: 'Download as Markdown' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', twinOf(TOPIC_PAGE));
    await expect(link).toHaveAttribute('download', '');

    const alternate = page.locator('head link[rel="alternate"][type="text/markdown"]');
    await expect(alternate).toHaveCount(1);
    await expect(alternate).toHaveAttribute('href', twinOf(TOPIC_PAGE));
  });

  test('the twin resolves to plain Markdown with the documentation and none of the chrome', async ({ request }) => {
    const response = await request.get(twinOf(TOPIC_PAGE));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/markdown');

    const body = await response.text();
    expect(body.startsWith('# Topic\n')).toBe(true);
    expect(body).toContain('```ts');
    for (const marker of ['<LanguageTabs', 'lang-variant', '<Badge', '<nav', '---\n']) {
      expect(body).not.toContain(marker);
    }
  });

  test('an overview page has a twin too, and it keeps the README prose', async ({ page, request }) => {
    await page.goto(SQS_OVERVIEW_PAGE);
    const link = page.locator('.page-footer-links .footer-link', { hasText: 'Download as Markdown' });
    await expect(link).toHaveAttribute('href', twinOf(SQS_OVERVIEW_PAGE));

    const body = await (await request.get(twinOf(SQS_OVERVIEW_PAGE))).text();
    expect(body.startsWith('# ')).toBe(true);
    expect(body).toContain('Queue');
    expect(body).not.toContain('<span');
  });

  test('the homepage advertises and serves its root Markdown twin', async ({ page, request }) => {
    await page.goto('/');

    const alternate = page.locator('head link[rel="alternate"][type="text/markdown"]');
    await expect(alternate).toHaveCount(1);
    await expect(alternate).toHaveAttribute('href', '/index.md');

    const response = await request.get('/index.md');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/markdown');

    const body = await response.text();
    expect(body).toContain('# AWS CDK API Reference');
    expect(body).toContain('## What is the AWS CDK');
    expect(body).toContain('## Getting started');
    expect(body).not.toContain('layout: home');
  });
});
