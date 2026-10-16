import { toAgentMarkdown, withFrontmatterKey } from '../src/docgen/agent-markdown.js';

describe('withFrontmatterKey', () => {
  test('inserts into an existing block right after the opening fence', () => {
    expect(withFrontmatterKey('---\ntitle: "Bucket"\n---\n\n# Bucket\n', 'agentMarkdown', '/v2/docs/x.md')).toBe(
      '---\nagentMarkdown: "/v2/docs/x.md"\ntitle: "Bucket"\n---\n\n# Bucket\n',
    );
  });

  test('opens a block when the page has none', () => {
    expect(withFrontmatterKey('# Bucket\n', 'agentMarkdown', '/v2/docs/x.md')).toBe(
      '---\nagentMarkdown: "/v2/docs/x.md"\n---\n\n# Bucket\n',
    );
  });
});

// A page shaped like the real emission: frontmatter, breadcrumb nav, badged H1 with a Pagefind weight span, a
// LanguageTabs block with one variant per language, inline variant spans in a table, a container and the trailing
// hidden filter spans.
const PAGE = [
  '---',
  'title: "Bucket"',
  '---',
  '',
  '<nav class="type-breadcrumb" aria-label="Module hierarchy" data-pagefind-ignore>',
  '',
  '<span class="breadcrumb-trail">[aws-cdk-lib](/v2/docs/aws-cdk-lib-readme).aws_s3.Bucket</span>',
  '',
  '<span class="breadcrumb-fav"></span>',
  '',
  '</nav>',
  '',
  '# <span data-pagefind-weight="10">Bucket</span> <Badge type="tip" class="api-badge api-badge-l2" text="L2" />' +
    ' <Badge type="tip" class="api-badge" text="Added in v2.200.0" />',
  '',
  'An S3 bucket with helpers.',
  '',
  '::: warning Separate package',
  'Install `@aws-cdk/aws-s3-alpha` separately.',
  ':::',
  '',
  '## Initializer',
  '',
  '<LanguageTabs :langs="[\'ts\', \'python\']">',
  '<div class="lang-variant" data-lang="ts">',
  '',
  '```ts',
  'new Bucket(scope: Construct, id: string, props?: BucketProps)',
  '```',
  '',
  '</div>',
  '<div class="lang-variant" data-lang="python" v-pre data-pagefind-ignore>',
  '',
  '```python',
  'Bucket(scope, id, *, versioned=None)',
  '```',
  '',
  '</div>',
  '</LanguageTabs>',
  '',
  '## Properties',
  '',
  '<LanguageTabs :langs="[\'ts\', \'python\']">',
  '',
  '| Name | Type |',
  '| --- | --- |',
  '| <span class="lang-variant" data-lang="ts">bucketArn</span>' +
    '<span class="lang-variant" data-lang="python" data-pagefind-ignore>bucket_arn</span> | `string` |',
  '',
  '</LanguageTabs>',
  '',
  '<div v-pre>',
  '',
  'See [BucketProps](/v2/docs/aws-cdk-lib.aws_s3.BucketProps).',
  '',
  '</div>',
  '',
  '<span hidden data-pagefind-filter="module:aws-cdk-lib.aws_s3"></span>' +
    '<span hidden data-pagefind-filter="kind:class"></span>',
  '',
].join('\n');

describe('toAgentMarkdown', () => {
  const { markdown } = toAgentMarkdown(PAGE);

  test('drops every browser-only construct', () => {
    expect(markdown).not.toMatch(/^---/m);
    expect(markdown).not.toContain('<nav');
    expect(markdown).not.toContain('<Badge');
    expect(markdown).not.toContain('LanguageTabs');
    expect(markdown).not.toContain('lang-variant');
    expect(markdown).not.toContain('data-pagefind');
    expect(markdown).not.toContain('<div');
    expect(markdown).not.toContain('<span');
  });

  test('keeps only the canonical TypeScript variant', () => {
    expect(markdown).toContain('```ts\nnew Bucket(scope: Construct, id: string, props?: BucketProps)\n```');
    expect(markdown).not.toContain('```python');
    expect(markdown).toContain('| bucketArn | `string` |');
    expect(markdown).not.toContain('bucket_arn');
  });

  test('preserves the documentation content', () => {
    expect(markdown.startsWith('# Bucket\n')).toBe(true);
    expect(markdown).toContain('An S3 bucket with helpers.');
    expect(markdown).toContain('## Initializer');
    expect(markdown).toContain('| Name | Type |');
    expect(markdown).toContain('See [BucketProps](/v2/docs/aws-cdk-lib.aws_s3.BucketProps).');
  });

  test('turns a container into a blockquote', () => {
    expect(markdown).toContain('> **Separate package**\n>\n> Install `@aws-cdk/aws-s3-alpha` separately.');
    expect(markdown).not.toContain(':::');
  });

  test('normalizes whitespace and ends with one newline', () => {
    expect(markdown).not.toMatch(/\n{3,}/);
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
  });
});

// README prose reaches the page verbatim, and jsii docstrings escape only `<` in prose, so documentation text that
// looks like a tag arrives in three shapes: inside a code span, inside a fence, and escaped in prose. All of it is
// content and must come out exactly as written.
describe('toAgentMarkdown keeps documentation text that looks like markup', () => {
  test('inside inline code spans', () => {
    const page =
      'Use one of the `add<Event>Notification` methods, or `from<Resource>Arn` (where `<Resource>` is a type).\n';
    expect(toAgentMarkdown(page).markdown).toBe(page);
  });

  test('inside a fenced block, and the fence keeps only its language tag', () => {
    const page = [
      '```json type-links=Foo:/v2/docs/Foo.html',
      '{ "Resource": "arn:aws:cloudfront::111122223333:distribution/<CloudFront distribution ID>" }',
      '```',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe(page.replace(' type-links=Foo:/v2/docs/Foo.html', ''));
  });

  test('an indented fence with a longer marker run is still a fence', () => {
    const page = 'Example:\n\n ````ts\nconst x: Array<string> = [];\n````\n';
    expect(toAgentMarkdown(page).markdown).toBe(page);
  });

  test('escaped in prose, decoded back to what the author wrote', () => {
    const page = 'Replace &lt;REGION> with your region and &lt;ISO country code> as needed.\n';
    expect(toAgentMarkdown(page).markdown)
      .toBe('Replace <REGION> with your region and <ISO country code> as needed.\n');
  });

  test('an unknown tag in raw prose is put back rather than swallowed', () => {
    expect(toAgentMarkdown('The name is /aws/lambda/<function name> by default.\n').markdown).toBe(
      'The name is /aws/lambda/<function name> by default.\n',
    );
  });

  test('CommonMark autolinks and bare placeholders in README prose', () => {
    const page = [
      'See <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html> for more.',
      'Each <Stack> in the pipeline writes `├── <filename>.js`, and <CloudFront distribution ID> stays as typed.',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe(page);
  });

  test('an indented code block keeps its indentation and its angle brackets', () => {
    const page = 'Layout:\n\n    src/<service>/index.ts\n    src/<service>/README.md\n\nEnd.\n';
    expect(toAgentMarkdown(page).markdown).toBe(page);
  });

  test('a closing tag that is documentation text survives, and escaped code spans decode', () => {
    const page = 'Write `<persist>true</persist>` to the script. A `<row></row>` element is fine.\n';
    expect(toAgentMarkdown(page).markdown).toBe(page);
    expect(toAgentMarkdown('<div class="member-summary">Prefixed with `glue.&lt;executorId&gt;.`.</div>\n').markdown)
      .toBe('Prefixed with `glue.<executorId>.`.\n');
  });

  test('a fenced block inside a member description is indented whole, under its bullet', () => {
    const page = [
      '<div class="member-row"><div class="member-line"><code class="member-name">addEventNotification</code></div>',
      '<div class="member-summary">Adds a destination.</div>',
      '<div class="member-extra">',
      '',
      'For example:',
      '',
      '```ts',
      'bucket.addEventNotification(EventType.OBJECT_CREATED, dest);',
      '```',
      '',
      '</div></div>',
      '<div class="member-row"><div class="member-line"><code class="member-name">addInventory</code></div>',
      '<div class="member-summary">Adds an inventory.</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe([
      '- `addEventNotification` — Adds a destination.',
      '',
      '  For example:',
      '',
      '  ```ts',
      '  bucket.addEventNotification(EventType.OBJECT_CREATED, dest);',
      '  ```',
      '',
      '- `addInventory` — Adds an inventory.',
      '',
    ].join('\n'));
  });

  test('a backtick inside an attribute value is not a code span', () => {
    const page = [
      '<div class="member-row"><div class="member-line"><code class="member-name">ttl</code>',
      '<span class="member-default" title="The greater of 1 day and ``minTtl``">= The greater…</span></div>',
      '<div class="member-summary">How long.</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('- `ttl` = The greater of 1 day and ``minTtl`` — How long.\n');
  });
});
