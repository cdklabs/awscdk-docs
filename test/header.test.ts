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
      '<a href="/api/modules/ts/aws-cdk-lib/">aws-cdk-lib</a>.<wbr><a href="/api/modules/ts/aws-cdk-lib/aws-s3.html">aws_s3</a>.<wbr><strong>Bucket</strong>',
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
      '<a href="/api/modules/ts/aws-cdk-lib/">aws-cdk-lib</a>.<wbr><span class="breadcrumb-segment">interfaces</span>.<wbr><a href="/api/modules/ts/aws-cdk-lib/interfaces-aws-s3.html">aws_s3</a>.<wbr><strong>IBucketRef</strong>',
    );
    expect(block).not.toContain('<strong>interfaces</strong>');
  });

  test('every segment is an element, so padding can space them all alike', () => {
    // The trail's separator is a bare `.` and the visual gaps are padding, so
    // a segment emitted as a raw text node would render with no gap around it.
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
    expect(separators).toBe('.<wbr>.<wbr>');
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
    expect(block).toContain('.<wbr><a href="/pkg/sub/leaf.html">leaf</a>.<wbr><strong>Type</strong>');
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
      '<a href="/pkg/">pkg</a>.<wbr><a href="/pkg/sub.html">sub</a>.<wbr><span class="breadcrumb-ellipsis" title="deep-a.deep-b">deep-a.deep-b</span>.<wbr><a href="/pkg/sub/Parent.html">Parent</a>.<wbr><strong>Type</strong>',
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
      '<a href="/aws-cdk-lib.html">aws-cdk-lib</a>.<wbr><a href="/aws-cdk-lib.aws_sns.html">aws_sns</a>.<wbr><strong>CfnTopic.<wbr>SubscriptionProperty</strong>',
    );
    // Two joins plus the nested type's own dot; the link targets' dots are not text and get none.
    expect(trail.match(/<wbr>/g)!.length).toBe(3);
  });
});
