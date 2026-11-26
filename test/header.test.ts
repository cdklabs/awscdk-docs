import * as spec from '@jsii/spec';
import { renderTypeHeader, renderTypeHeaderFor } from '../src/docgen/header.js';
import { renderBreadcrumb } from '../src/docgen/header.js';

describe('type page header bar', () => {
  beforeEach(() => {
    delete process.env.DOCS_BASE;
  });

  test('labels and links are text and hrefs, never markdown or markup', () => {
    const block = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: 'a](/x) <img src=x onerror=alert(1)>', link: '/pkg/a"b' },
      { label: 'Ty<b>pe</b> {{ x }}' },
    ]).join('\n');
    expect(block).toContain(
      '<a href="/pkg/a&quot;b.html">a](/x) &lt;img src=x onerror=alert(1)&gt;</a>',
    );
    expect(block).toContain('<strong>Ty&lt;b&gt;pe&lt;/b&gt; &#123;&#123; x &#125;&#125;</strong>');
    expect(block).not.toContain('<img');
    expect(() => renderBreadcrumb([{ label: 'pkg', link: '//evil.example/' }, { label: 'T' }])).toThrow(
      /not a site-relative page link/,
    );
  });

  test('breadcrumb links ancestor segments and leaves the current one unlinked', () => {
    const block = renderBreadcrumb([
      { label: 'aws-cdk-lib', link: '/api/modules/ts/aws-cdk-lib/' },
      { label: 'aws_s3', link: '/api/modules/ts/aws-cdk-lib/aws-s3' },
      { label: 'Bucket' },
    ]).join('\n');
    expect(block).toContain(
      '<a href="/api/modules/ts/aws-cdk-lib/">aws-cdk-lib</a><span class="breadcrumb-dot">.</span><wbr><a href="/api/modules/ts/aws-cdk-lib/aws-s3.html">aws_s3</a><span class="breadcrumb-dot">.</span><wbr><strong>Bucket</strong>',
    );
    // Excluded from the search index, like the table it replaces
    expect(block).toMatch(/<nav class="type-breadcrumb"[^>]*data-pagefind-ignore>/);
    // Blank line after the closing tag so the following H1 is not
    // swallowed into the raw-HTML block.
    expect(block).toMatch(/<\/nav>\n$/);
  });

  test('breadcrumb bar carries the favorite mount point', () => {
    const block = renderBreadcrumb([
      { label: 'aws-cdk-lib', link: '/api/modules/ts/aws-cdk-lib/' },
      { label: 'Bucket' },
    ]).join('\n');
    // The theme's FavoriteStar teleports its icon-only button in here,
    // so breadcrumb and favorite share one bar instead of two rows.
    expect(block).toContain('<span class="breadcrumb-fav"></span>');
    expect(block.indexOf('breadcrumb-fav')).toBeGreaterThan(block.indexOf('<strong>Bucket</strong>'));
  });

  test('an unlinked ancestor renders plain, only the current page renders bold', () => {
    // A structural grouping contributes a trail segment even when the
    // build emits no overview page for it. Bolding it would claim "you
    // are here" twice in one trail, so bold is reserved for the last.
    const block = renderBreadcrumb([
      { label: 'aws-cdk-lib', link: '/api/modules/ts/aws-cdk-lib/' },
      { label: 'interfaces' },
      { label: 'aws_s3', link: '/api/modules/ts/aws-cdk-lib/interfaces-aws-s3' },
      { label: 'IBucketRef' },
    ]).join('\n');
    expect(block).toContain(
      '<a href="/api/modules/ts/aws-cdk-lib/">aws-cdk-lib</a><span class="breadcrumb-dot">.</span><wbr><span class="breadcrumb-segment">interfaces</span><span class="breadcrumb-dot">.</span><wbr><a href="/api/modules/ts/aws-cdk-lib/interfaces-aws-s3.html">aws_s3</a><span class="breadcrumb-dot">.</span><wbr><strong>IBucketRef</strong>',
    );
    expect(block).not.toContain('<strong>interfaces</strong>');
  });

  test('every segment is an element, so the chevron separator can hang off it', () => {
    // The trail's separator in the DOM is a bare `.`, collapsed to no size and
    // replaced visually by a chevron drawn on each segment. A segment emitted
    // as a raw text node could carry neither.
    const block = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: 'grouping' },
      { label: 'Type' },
    ]).join('\n');
    const trail = block.match(/<span class="breadcrumb-trail">(.*)<\/span>/)![1];
    // Strip every element, and only the separators remain.
    const separators = trail
      .replace(/<span class="breadcrumb-segment">[^<]*<\/span>/g, '')
      .replace(/<a [^>]*>[^<]*<\/a>/g, '')
      .replace(/<strong>[^<]*<\/strong>/g, '');
    expect(separators).toBe('<span class="breadcrumb-dot">.</span><wbr><span class="breadcrumb-dot">.</span><wbr>');
  });

  test('collapsed labels stay in the output, so the trail still copies as the whole FQN', () => {
    // The `title` is hover text, not the source of truth: the labels must be
    // emitted as text or a selection copies an ellipsis instead of the FQN.
    const block = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: 'sub', link: '/pkg/sub' },
      { label: 'deep-a' },
      { label: 'deep-b' },
      { label: 'Parent', link: '/pkg/sub/Parent' },
      { label: 'Type' },
    ]).join('\n');
    const ellipsis = block.match(/<span class="breadcrumb-ellipsis"[^>]*>([^<]*)<\/span>/)![1];
    expect(ellipsis).toBe('deep-a.deep-b');
    expect(ellipsis).not.toContain('…');
  });

  test('a label with braces cannot reach Vue as template interpolation', () => {
    // Both new text nodes — the unlinked segment wrapper and the collapsed
    // labels — sit in raw HTML inside markdown, so `{`/`}` must be escaped or
    // VitePress compiles them.
    const unlinked = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: '{{ evil }}' },
      { label: 'Type' },
    ]).join('\n');
    expect(unlinked).toContain('<span class="breadcrumb-segment">&#123;&#123; evil &#125;&#125;</span>');
    expect(unlinked).not.toContain('{{ evil }}');

    const collapsed = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: 'sub', link: '/pkg/sub' },
      { label: '{{ a }}' },
      { label: '{{ b }}' },
      { label: 'Parent', link: '/pkg/sub/Parent' },
      { label: 'Type' },
    ]).join('\n');
    const ellipsis = collapsed.match(/<span class="breadcrumb-ellipsis"[^>]*>([^<]*)<\/span>/)![1];
    expect(ellipsis).not.toContain('{{');
    expect(ellipsis).toContain('&#123;');
  });

  test('collapsing keeps the current-page marker on the real last segment', () => {
    // The collapse slices the rendered crumbs, so "is this the last
    // segment" has to be decided on the absolute index — deciding it
    // after slicing would read a slice-relative index and drop the bold.
    const block = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: 'sub', link: '/pkg/sub' },
      { label: 'mid-a', link: '/pkg/sub/mid-a' },
      { label: 'grouping' },
      { label: 'leaf', link: '/pkg/sub/leaf' },
      { label: 'Type' },
    ]).join('\n');
    expect(block).toContain('breadcrumb-ellipsis');
    expect(block).toContain('<span class="breadcrumb-dot">.</span><wbr><a href="/pkg/sub/leaf.html">leaf</a><span class="breadcrumb-dot">.</span><wbr><strong>Type</strong>');
    // The unlinked middle segment is hidden by the collapse, and its
    // label still appears in the ellipsis hover text.
    expect(block).toContain('title="mid-a.grouping"');
  });

  test('breadcrumb renders nothing without segments', () => {
    expect(renderBreadcrumb([])).toEqual([]);
  });

  test('short breadcrumbs never collapse', () => {
    const block = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: 'sub', link: '/pkg/sub' },
      { label: 'Parent', link: '/pkg/sub/Parent' },
      { label: 'Type' },
    ]).join('\n');
    expect(block).not.toContain('breadcrumb-ellipsis');
    expect(block).toContain('<a href="/pkg/sub/Parent.html">Parent</a>');
  });

  test('over-long breadcrumbs collapse middle segments, keeping the first two and the last two', () => {
    const block = renderBreadcrumb([
      { label: 'pkg', link: '/pkg/' },
      { label: 'sub', link: '/pkg/sub' },
      { label: 'deep-a', link: '/pkg/sub/deep-a' },
      { label: 'deep-b', link: '/pkg/sub/deep-b' },
      { label: 'Parent', link: '/pkg/sub/Parent' },
      { label: 'Type' },
    ]).join('\n');
    // First two (package + submodule) and the segment directly above the
    // current type stay visible; the middle collapses to an ellipsis.
    expect(block).toContain(
      '<a href="/pkg/">pkg</a><span class="breadcrumb-dot">.</span><wbr><a href="/pkg/sub.html">sub</a><span class="breadcrumb-dot">.</span><wbr><span class="breadcrumb-ellipsis" title="deep-a.deep-b">deep-a.deep-b</span><span class="breadcrumb-dot">.</span><wbr><a href="/pkg/sub/Parent.html">Parent</a><span class="breadcrumb-dot">.</span><wbr><strong>Type</strong>',
    );
    expect(block).not.toContain('>deep-a</a>');
    expect(block).not.toContain('>deep-b</a>');
  });
  test('every dot is followed by a wrap opportunity, including the dot inside a nested type', () => {
    // The dots carry no whitespace, so a `<wbr>` after each one is what lets a narrow line break between
    // segments rather than inside one; it is empty, so the selection still copies the FQN.
    const block = renderBreadcrumb([
      { label: 'aws-cdk-lib', link: '/aws-cdk-lib' },
      { label: 'aws_sns', link: '/aws-cdk-lib.aws_sns' },
      { label: 'CfnTopic.SubscriptionProperty' },
    ]).join('\n');
    const trail = block.match(/<span class="breadcrumb-trail">(.*)<\/span>/)![1];
    expect(trail).toBe(
      '<a href="/aws-cdk-lib.html">aws-cdk-lib</a><span class="breadcrumb-dot">.</span><wbr><a href="/aws-cdk-lib.aws_sns.html">aws_sns</a><span class="breadcrumb-dot">.</span><wbr><strong>CfnTopic.<wbr>SubscriptionProperty</strong>',
    );
    // Two joins plus the nested type's own dot; the link targets' dots are not text and get none.
    expect(trail.match(/<wbr>/g)!.length).toBe(3);
    // Only the JOINS are wrapped for collapsing. The nested type's own dot is
    // part of the name a reader reads, so it stays a bare, visible character.
    expect(trail.match(/breadcrumb-dot/g)!.length).toBe(2);
    expect(trail).toContain('<strong>CfnTopic.<wbr>SubscriptionProperty</strong>');
  });
});

describe('type page header', () => {
  beforeEach(() => {
    delete process.env.DOCS_BASE;
  });

  const header = (options: Parameters<typeof renderTypeHeader>[0]): string =>
    renderTypeHeader(options).join('\n');

  test('the H1 carries the type name alone and the kind becomes a chip of the row below it', () => {
    const block = header({ name: 'Bucket', kind: { text: 'L2 construct', kindClass: 'api-badge-l2' } });
    expect(block.split('\n')[0]).toBe('# <span data-pagefind-weight="10">Bucket</span>');
    expect(block).toContain('<span class="type-chip type-chip-kind api-badge-l2">L2 construct</span>');
    // The row is one raw-HTML block, so markdown-it hands it through whole.
    expect(block).toContain('<div class="type-header-row" data-pagefind-ignore>');
    // Two mount points in a fixed order, so the copy button always precedes
    // the star however the two components happen to mount.
    const actions = block.indexOf('<span class="type-actions">');
    expect(block.indexOf('type-action-copy')).toBeGreaterThan(actions);
    expect(block.indexOf('type-action-fav')).toBeGreaterThan(block.indexOf('type-action-copy'));
  });

  test('the kind chip comes before the stability chip, and the actions after both', () => {
    const block = header({ name: 'Bucket', kind: { text: 'Class' }, stability: 'stable' });
    const kind = block.indexOf('type-chip-kind');
    const stability = block.indexOf('type-chip-stability');
    expect(kind).toBeGreaterThan(-1);
    expect(stability).toBeGreaterThan(kind);
    expect(block.indexOf('type-header-gap')).toBeGreaterThan(stability);
    expect(block.indexOf('type-actions')).toBeGreaterThan(block.indexOf('type-header-gap'));
  });

  test('a stable type says so, rather than leaving the absence of a chip to mean two things', () => {
    expect(header({ name: 'Bucket', kind: { text: 'Class' }, stability: 'stable' }))
      .toContain('<span class="type-chip type-chip-stability type-chip-stable">Stable</span>');
  });

  test('the experimental chip links to the page that explains the level', () => {
    const block = header({ name: 'Service', kind: { text: 'Class' }, stability: 'experimental' });
    expect(block).toContain(
      '<a class="type-chip type-chip-stability type-chip-experimental" href="/stability.html">Experimental</a>',
    );
  });

  test('a deprecated type strikes its title and carries the reason under the row', () => {
    const block = header({
      name: 'Statistic',
      kind: { text: 'Enum', kindClass: 'api-badge-enum' },
      stability: 'deprecated',
      deprecationReason: 'Use `Stats` instead.',
    });
    expect(block).toContain('# <span class="type-title-deprecated"><span data-pagefind-weight="10">Statistic</span></span>');
    expect(block).toContain('<span class="type-chip type-chip-stability type-chip-deprecated">Deprecated</span>');
    expect(block).toContain('<p class="type-deprecated-note"><strong>Deprecated:</strong> Use `Stats` instead.</p>');
    // The note sits inside the header block, so the divider closes below it.
    expect(block.indexOf('type-deprecated-note')).toBeLessThan(block.lastIndexOf('</div>'));
  });

  test('a deprecated type with no stated reason shows the chip and no empty note', () => {
    const block = header({ name: 'Statistic', kind: { text: 'Enum' }, stability: 'deprecated' });
    expect(block).toContain('type-chip-deprecated');
    expect(block).not.toContain('type-deprecated-note');
  });

  test('a stability with no chip of its own renders the kind alone', () => {
    for (const block of [
      header({ name: 'T', kind: { text: 'Class' } }),
      header({ name: 'T', kind: { text: 'Class' }, stability: 'external' }),
    ]) {
      expect(block).toContain('type-chip-kind');
      expect(block).not.toContain('type-chip-stability');
    }
  });

  test('chip text and the deprecation reason are text, never markup or Vue syntax', () => {
    const block = header({
      name: 'T',
      kind: { text: '<img src=x> {{ x }}' },
      stability: 'deprecated',
      deprecationReason: 'see <b>docs</b> {{ y }}',
    });
    expect(block).toContain('&lt;img src=x&gt; &#123;&#123; x &#125;&#125;');
    expect(block).toContain('see &lt;b&gt;docs&lt;/b&gt; &#123;&#123; y &#125;&#125;');
    expect(block).not.toContain('<img');
    expect(block).not.toContain('<b>');
  });

  test('the stability is the type\'s own when set, otherwise its package\'s', () => {
    const assembly = { name: 'pkg', docs: { stability: spec.Stability.Experimental } } as unknown as spec.Assembly;
    const kind = { text: 'Class' };
    const untagged = { name: 'T', fqn: 'pkg.T' } as unknown as spec.Type;
    const tagged = { name: 'T', fqn: 'pkg.T', docs: { stability: spec.Stability.Stable } } as unknown as spec.Type;
    expect(renderTypeHeaderFor(untagged, assembly, kind).join('\n')).toContain('type-chip-experimental');
    expect(renderTypeHeaderFor(tagged, assembly, kind).join('\n')).toContain('type-chip-stable');
  });
});
