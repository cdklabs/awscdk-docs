import { expect, test } from '@playwright/test';
import { CFN_QUEUE_PAGE, REPRESENTATIVE_PAGES } from './fixture.js';

// Every page carries one JSON-LD node: `WebSite` on the home page, `TechArticle` elsewhere. `dateModified` is the
// release-derived revised date, which is the same value the `cdk-docs-content-revised` meta carries.

const SCRIPT = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

async function nodes(page: import('@playwright/test').Page, url: string): Promise<any[]> {
  const response = await page.goto(url);
  const html = await response!.text();
  return [...html.matchAll(SCRIPT)].map((match) => JSON.parse(match[1]));
}

test.describe('structured data', () => {
  test('every page carries exactly one JSON-LD node and it parses', async ({ page }) => {
    for (const url of [...REPRESENTATIVE_PAGES, CFN_QUEUE_PAGE]) {
      const parsed = await nodes(page, url);
      expect(parsed, url).toHaveLength(1);
      expect(parsed[0]['@context'], url).toBe('https://schema.org');
    }
  });

  test('the home page is the WebSite node, with its publisher', async ({ page }) => {
    const [node] = await nodes(page, '/');
    expect(node['@type']).toBe('WebSite');
    expect(node['@id']).toMatch(/#website$/);
    expect(node.url).toMatch(/^https?:\/\/.+\/$/);
    expect(node.publisher).toMatchObject({ '@type': 'Organization', 'name': 'Amazon Web Services' });
    const revised = await page.locator('meta[name="cdk-docs-content-revised"]').getAttribute('content');
    expect(node.dateModified).toBe(revised);
  });

  test('an API page is a TechArticle pointing at its own URL and at the site node', async ({ page }) => {
    const [node] = await nodes(page, CFN_QUEUE_PAGE);
    expect(node['@type']).toBe('TechArticle');
    expect(node.headline).toBe('CfnQueue');
    expect(node.url).toMatch(/^https?:\/\/.+aws-cdk-lib\.aws_sqs\.CfnQueue\.html$/);
    expect(node.isPartOf['@id']).toMatch(/#website$/);
    expect(node.publisher['@type']).toBe('Organization');
  });

  test('dateModified is the recorded revised date, not the day of the build', async ({ page }) => {
    const [node] = await nodes(page, CFN_QUEUE_PAGE);
    const revised = await page.locator('meta[name="cdk-docs-content-revised"]').getAttribute('content');
    expect(node.dateModified).toBe(revised);
    expect(node.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(node.dateModified.slice(0, 10)).not.toBe(new Date().toISOString().slice(0, 10));
  });
});
