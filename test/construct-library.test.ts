import { readFileSync } from 'fs';
import { resolve } from 'path';
import { typePageLink } from '../src/docgen/links.js';
import { API_DOCS_ROOT, STABILITY_ROUTE } from '../src/site-routes.js';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * The worked example's three links are the page's whole reason for existing as
 * an entry point rather than an explainer, and `ignoreDeadLinks` means a
 * page-naming change in docgen would leave them rendering as live links to a
 * 404. So they are derived from the same helper that generates the pages: if
 * the naming moves, the derived href moves with it and this page no longer
 * contains it.
 */
const LINKED_TYPES: readonly [string, string, string][] = [
  ['aws-cdk-lib', 'aws_sqs', 'CfnQueue'],
  ['aws-cdk-lib', 'aws_sqs', 'Queue'],
  ['aws-cdk-lib', 'aws_ecs_patterns', 'ApplicationLoadBalancedFargateService'],
];

describe('construct library overview page', () => {
  const page = readFileSync(resolve(ROOT, 'docs/construct-library.md'), 'utf-8');

  test.each(LINKED_TYPES)('links the generated page for %s.%s.%s', (assembly, submodule, typeName) => {
    expect(page).toContain(`(${typePageLink(assembly, submodule, typeName)})`);
  });

  test('every reference link targets the generated api tree or the stability guide', () => {
    const links = page.match(/\]\((\/[^)]*)\)/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.slice(2, -1);
      expect(href.startsWith(API_DOCS_ROOT) || href === STABILITY_ROUTE).toBe(true);
    }
    expect(links).toContain(`](${STABILITY_ROUTE})`);
  });

  test('reference links carry no .html suffix, which VitePress appends', () => {
    expect(page).not.toMatch(/\]\(\/v2\/[^)]*\.html\)/);
  });

  test('the construct levels and module naming sections are present', () => {
    expect(page).toContain('## Construct levels');
    expect(page).toContain('## Module names');
    expect(page).toContain('## What a module contains');
  });
});
