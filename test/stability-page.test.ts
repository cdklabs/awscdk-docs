import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pageHref } from '../src/docgen/links.js';
import { STABILITY_ROUTE } from '../src/site-routes.js';

const ROOT = resolve(import.meta.dirname, '..');

describe('api stability guide page', () => {
  const page = readFileSync(resolve(ROOT, `docs${STABILITY_ROUTE}.md`), 'utf-8');

  test('the route resolves to a page under docs/ that the type-page indicator can link', () => {
    expect(STABILITY_ROUTE).toBe('/stability');
    expect(pageHref(STABILITY_ROUTE)).toBe('/stability.html');
    expect(page).toMatch(/^# API Stability\n/);
  });

  test('explains both levels a type page can carry', () => {
    expect(page).toContain('## Stable');
    expect(page).toContain('## Experimental');
    // The words the reader arrives on: the indicator's label and the module page's caveat.
    expect(page).toContain('**Stability: Experimental**');
    expect(page).toContain('without a major version bump');
  });

  test('tells the reader that a missing indicator means stable', () => {
    expect(page).toContain('the absence of an indicator means stable');
  });

  test('stays out of the navbar, whose three entries are the layout budget', () => {
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    const nav = /nav:\s*\[([\s\S]*?)\n\s*\],/.exec(config)![1];
    expect(nav).not.toContain('stability');
  });
});
