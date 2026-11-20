import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FENCE_LANG, type Language } from '../src/docgen/languages.js';
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
  const page = readFileSync(resolve(ROOT, 'docs/aws-construct-library.md'), 'utf-8');

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

  test('every code example has a variant for each enabled language', () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, 'docgen.config.json'), 'utf-8')) as { languages: string[] };
    const groups = [...page.matchAll(/<LanguageTabs :langs="\[([^\]]*)\]">([\s\S]*?)<\/LanguageTabs>/g)];
    expect(groups.length).toBe(2);
    for (const [, langs, body] of groups) {
      const declared = langs.split(',').map((l) => l.trim().replace(/'/g, ''));
      const variants = [...body.matchAll(/<div class="lang-variant" data-lang="(\w+)"/g)].map((m) => m[1]);
      expect([...declared].sort()).toEqual([...config.languages].sort());
      expect([...variants].sort()).toEqual([...config.languages].sort());
      expect(body.match(/^```\w+/gm)).toHaveLength(config.languages.length);
      const fences = [...body.matchAll(/<div class="lang-variant" data-lang="(\w+)"[^>]*>\s*```(\w+)/g)];
      expect(fences).toHaveLength(config.languages.length);
      for (const [, lang, fence] of fences) {
        expect([lang, fence]).toEqual([lang, FENCE_LANG[lang as Language]]);
      }
    }
    const outside = groups.reduce((text, [group]) => text.replace(group, ''), page);
    expect(outside).not.toMatch(/^```/m);
  });

  test('only the TypeScript example variants are searchable, and none are v-pre', () => {
    const variants = [...page.matchAll(/<div class="lang-variant" data-lang="(\w+)"([^>]*)>/g)];
    expect(variants.length).toBeGreaterThan(0);
    for (const [, lang, attrs] of variants) {
      expect(attrs.includes('data-pagefind-ignore')).toBe(lang !== 'ts');
      expect(attrs).not.toContain('v-pre');
    }
  });

  test('the Python examples use snake_case keyword arguments', () => {
    const python = [...page.matchAll(/data-lang="python"[^>]*>\s*```python\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
    for (const name of ['queue_name', 'visibility_timeout', 'dead_letter_queue', 'max_receive_count']) {
      expect(python).toContain(`${name}=`);
    }
  });

  test('the construct levels and module naming sections are present', () => {
    expect(page).toContain('## Construct levels');
    expect(page).toContain('## Module names');
    expect(page).toContain('## What a module contains');
  });
});
