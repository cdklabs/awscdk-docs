import { cleanHeadingLabel } from '../docs/.vitepress/heading-label.js';
import { renderTypeHeader } from '../src/docgen/header.js';

// VitePress builds a permalink's `aria-label` from the heading token's raw `content`, so a heading whose source is
// markup needs that content rewritten first. These feed the function the exact shapes docgen emits.
describe('accessible permalink labels for docgen headings', () => {
  /** The H1 source line docgen produces, without the `{#…}` pin the markdown pipeline appends. */
  const h1 = (options: Parameters<typeof renderTypeHeader>[0]): string =>
    renderTypeHeader(options)[0].replace(/^# /, '');

  test('a type title announces the plain name', () => {
    expect(cleanHeadingLabel(h1({ name: 'Bucket', kind: { text: 'Class' } }))).toBe('Bucket');
  });

  test('a deprecated type title announces the name, not the wrapper markup', () => {
    // The struck title wraps the weighted span in one more element. The pattern is anchored, so without the
    // wrapper in it the whole H1 falls through uncleaned and the permalink reads out raw HTML.
    const source = h1({ name: 'Statistic', kind: { text: 'Enum' }, stability: 'deprecated' });
    expect(source).toContain('type-title-deprecated');
    expect(cleanHeadingLabel(source)).toBe('Statistic');
  });

  test('a name with wrap opportunities loses them, so the label is one word', () => {
    expect(cleanHeadingLabel(h1({ name: 'CfnBucket', kind: { text: 'L1 construct' } }))).toBe('CfnBucket');
    expect(cleanHeadingLabel(h1({
      name: 'CfnBucket',
      kind: { text: 'L1 construct' },
      stability: 'deprecated',
    }))).toBe('CfnBucket');
  });

  test('an Added in badge after the title is dropped from the label', () => {
    const source = `${h1({ name: 'Bucket', kind: { text: 'Class' } })} <Badge type="tip" class="api-badge" text="Added in v2.200.0" />`;
    expect(cleanHeadingLabel(source)).toBe('Bucket');
  });

  test('a member heading announces its canonical TypeScript name', () => {
    const source = '<span class="lang-variant" data-lang="ts">grantRead</span>'
      + '<span class="lang-variant" data-lang="python">grant_read</span>';
    expect(cleanHeadingLabel(source)).toBe('grantRead');
  });

  test('escaped characters are announced as themselves', () => {
    expect(cleanHeadingLabel('<span data-pagefind-weight="10">A&amp;B&lt;C&gt;D&quot;E</span>')).toBe('A&B<C>D"E');
  });

  test('a hand-written heading is left alone', () => {
    expect(cleanHeadingLabel('Getting started')).toBeUndefined();
    expect(cleanHeadingLabel('<em>emphasis</em>')).toBeUndefined();
  });
});
