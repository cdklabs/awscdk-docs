import { readFileSync } from 'fs';
import { resolve } from 'path';
import { contentRevisedText, historyHead, pageHistoryOf } from '../docs/.vitepress/page-history.js';
import { CONTENT_REVISED_DATE, contentRevised, formatDateOnly, HISTORY_META } from '../src/page-history.js';

const ROOT = resolve(import.meta.dirname, '..');

describe('CONTENT_REVISED_DATE', () => {
  test('is a date-only ISO value, so bumping it is a one-token edit', () => {
    expect(CONTENT_REVISED_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(CONTENT_REVISED_DATE)).not.toBeNaN();
  });

  test('is documented as a re-date lever, not as a floor or minimum', () => {
    const source = readFileSync(resolve(ROOT, 'src/page-history.ts'), 'utf-8');
    expect(source).toContain('Bump this to re-date every page');
    expect(source).not.toMatch(/\bfloor\b|\bminimum\b/i);
  });
});

describe('formatDateOnly', () => {
  test('renders the UTC calendar day, whatever the timestamp\'s time of day', () => {
    expect(formatDateOnly('2025-03-03T00:00:00.000Z')).toBe('3 Mar 2025');
    expect(formatDateOnly('2025-03-03T23:59:59.000Z')).toBe('3 Mar 2025');
    expect(formatDateOnly('2026-12-31T12:00:00.000Z')).toBe('31 Dec 2026');
  });
});

describe('contentRevised', () => {
  const constant = `${CONTENT_REVISED_DATE}T00:00:00.000Z`;

  test('with no history, the constant and no version', () => {
    expect(contentRevised({})).toEqual({ at: constant });
  });

  test('an older change is raised to the constant, and the version is dropped with it', () => {
    expect(contentRevised({ lastChangedIn: '2.150.0', lastChangedAt: '2025-03-03T00:00:00.000Z' })).toEqual({ at: constant });
  });

  test('a newer change wins and carries its version', () => {
    expect(contentRevised({ lastChangedIn: '2.300.0', lastChangedAt: '2099-01-02T03:04:05.000Z' }))
      .toEqual({ at: '2099-01-02T03:04:05.000Z', version: '2.300.0' });
  });

  test('a date without a version cannot win: the pair is recorded together or not at all', () => {
    expect(contentRevised({ lastChangedAt: '2099-01-02T03:04:05.000Z' })).toEqual({ at: constant });
  });
});

describe('frontmatter → head metas and footer text', () => {
  const full = {
    cdkDocsIntroducedIn: '2.100.0',
    cdkDocsLastChangedIn: '2.300.0',
    cdkDocsLastChangedAt: '2099-01-02T03:04:05.000Z',
  };

  test('every recorded value becomes a meta; the revised date is always last', () => {
    expect(historyHead(full)).toEqual([
      ['meta', { name: HISTORY_META.introducedIn, content: '2.100.0' }],
      ['meta', { name: HISTORY_META.lastChangedIn, content: '2.300.0' }],
      ['meta', { name: HISTORY_META.lastChangedAt, content: '2099-01-02T03:04:05.000Z' }],
      ['meta', { name: HISTORY_META.contentRevised, content: '2099-01-02T03:04:05.000Z' }],
    ]);
  });

  test('unknowns are absent, never emitted empty; a hand-written page still gets the revised date', () => {
    expect(historyHead({})).toEqual([
      ['meta', { name: HISTORY_META.contentRevised, content: `${CONTENT_REVISED_DATE}T00:00:00.000Z` }],
    ]);
    expect(historyHead({ cdkDocsIntroducedIn: '', cdkDocsLastChangedIn: '2.1.0' })).toEqual([
      ['meta', { name: HISTORY_META.contentRevised, content: `${CONTENT_REVISED_DATE}T00:00:00.000Z` }],
    ]);
  });

  test('pageHistoryOf ignores non-string values', () => {
    expect(pageHistoryOf({ cdkDocsIntroducedIn: 2, cdkDocsLastChangedIn: '2.1.0', cdkDocsLastChangedAt: null })).toEqual({});
  });

  test('footer text names the version only when the page\'s own change set the date', () => {
    expect(contentRevisedText(full)).toBe('Content revised 2 Jan 2099 · v2.300.0');
    expect(contentRevisedText({})).toBe(`Content revised ${formatDateOnly(CONTENT_REVISED_DATE)}`);
    expect(contentRevisedText({ cdkDocsLastChangedIn: '2.150.0', cdkDocsLastChangedAt: '2025-03-03T00:00:00.000Z' }))
      .toBe(`Content revised ${formatDateOnly(CONTENT_REVISED_DATE)}`);
  });
});

describe('theme wiring', () => {
  test('the footer renders the revised line from frontmatter on every page, and the config lifts the metas', () => {
    const footer = readFileSync(resolve(ROOT, 'docs/.vitepress/theme/PageFooterLinks.vue'), 'utf-8');
    expect(footer).toContain('contentRevisedText(page.value.frontmatter ?? {})');
    expect(footer).toMatch(/<span class="footer-revised">\{\{ revised \}\}<\/span>/);
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    expect(config).toContain('historyHead(pageData.frontmatter)');
    // Not routed through themeConfig or the site-wide stamp: both would be wrong for per-page values.
    expect(config).not.toMatch(/cdkDocsIntroducedIn|cdk-docs-introduced-in/);
  });
});
