import { toAgentMarkdown, withFrontmatterKey } from '../src/docgen/agent-markdown.js';
import { renderOverviewPage } from '../src/docgen/index.js';
import { renderTypeMetadata } from '../src/docgen/layout.js';
import type { RosettaTablet } from '../src/docgen/rosetta.js';
import { docsSiteUrl } from '../src/docgen/versions.js';

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
  '# <span data-pagefind-weight="10">Bucket</span> <Badge type="tip" class="api-badge" text="Added in v2.200.0" />',
  '',
  '<div class="type-header">',
  '<div class="type-header-row" data-pagefind-ignore><span class="type-chip type-chip-kind api-badge-l2">L2'
    + ' construct</span><span class="type-chip type-chip-stability type-chip-stable">Stable</span>'
    + '<span class="type-header-gap"></span><span class="type-actions"><span class="type-action-copy"></span>'
    + '<span class="type-action-fav"></span></span></div>',
  '</div>',
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

  test('the kind and the stability survive as a line of their own under the title', () => {
    // The twin has no chips, so the row's words are what carries the
    // classification an agent would otherwise have to guess from the FQN. The
    // row's other children are empty action mounts and contribute nothing.
    expect(markdown).toContain('# Bucket\n\nL2 construct · Stable\n');
  });

  test('keeps every language variant, each block after a label line naming its language', () => {
    expect(markdown).toContain('TypeScript:\n\n```ts\nnew Bucket(scope: Construct, id: string, props?: BucketProps)\n```');
    expect(markdown).toContain('Python:\n\n```python\nBucket(scope, id, *, versioned=None)\n```');
    expect(markdown.indexOf('TypeScript:')).toBeLessThan(markdown.indexOf('Python:'));
  });

  test('an inline name keeps the canonical spelling, and prose and tables appear once', () => {
    expect(markdown).toContain('| bucketArn | `string` |');
    expect(markdown).not.toContain('bucket_arn');
    expect(markdown.match(/An S3 bucket with helpers\./g)).toHaveLength(1);
    expect(markdown.match(/\| Name \| Type \|/g)).toHaveLength(1);
  });

  test('preserves the documentation content', () => {
    expect(markdown.startsWith('# Bucket\n')).toBe(true);
    expect(markdown).toContain('An S3 bucket with helpers.');
    expect(markdown).toContain('## Initializer');
    expect(markdown).toContain('| Name | Type |');
    expect(markdown).toContain(
      `See [BucketProps](${docsSiteUrl()}v2/docs/aws-cdk-lib.aws_s3.BucketProps.html).`,
    );
  });

  test('rewrites site page links to published hrefs', () => {
    const previousBase = process.env.DOCS_BASE;
    process.env.DOCS_BASE = '/cdk/api/';
    try {
      const page = [
        'See [`HttpLambdaIntegration`](/v2/docs/aws-cdk-lib.aws_apigatewayv2_integrations.HttpLambdaIntegration#usage).',
        'Visit [stability](/stability), [versions](/versions?all=true#current), and [skills](/skills).',
        '<a href="/v2/docs/aws-cdk-lib.aws_s3.Bucket#objects">Bucket</a>',
        '<a href="/cdk/api/stability.html">Experimental</a>',
        'Keep [canonical](/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#objects),',
        '[twin](/v2/docs/Other.md), [Map](/v2/docs/aws-cdk-lib.aws_stepfunctions.Map),',
        '[map twin](/v2/docs/aws-cdk-lib.aws_stepfunctions.Map.md), and [data](/v2/data.json).',
        '[external](https://docs.aws.amazon.com/), and [local](#properties).',
        'Keep [cdn](//cdn.example.com/x), see ![img](/v2/docs/x.png),',
        'and see [index](/llms.txt).',
        '<a href="/v2/docs/a b">spaced</a>',
        '<a href="/v2/docs/a|b">piped</a>',
        '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki anchor</a>',
        'Keep [wiki](https://en.wikipedia.org/wiki/Foo_\\(bar\\)) and [pipe](https://example.com/a\\|b).',
        'Keep `[code](/v2/docs/Code)` unchanged; [escaped](/v2/docs/a\\_b) resolves too.',
        'See [s](/stability.md), [paren](/v2/docs/a\\(b), [bar](/v2/docs/a\\|b) and [shot](/img/Foo.PNG).',
        'Keep ``[double](/v2/docs/Double)`` unchanged.',
        'Use `new',
        'Bucket()` and see [Bucket](/v2/docs/aws-cdk-lib.aws_s3.Bucket).',
        '',
      ].join('\n');
      expect(toAgentMarkdown(page, 'https://docs.example.com/cdk/api').markdown).toBe([
        'See [`HttpLambdaIntegration`](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigatewayv2_integrations.HttpLambdaIntegration.html#usage).',
        'Visit [stability](https://docs.example.com/cdk/api/stability.html), [versions](https://docs.example.com/cdk/api/versions.html?all=true#current), and [skills](https://docs.example.com/cdk/api/skills.html).',
        '[Bucket](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#objects)',
        '[Experimental](https://docs.example.com/cdk/api/stability.html)',
        'Keep [canonical](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#objects),',
        '[twin](https://docs.example.com/cdk/api/v2/docs/Other.html), [Map](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_stepfunctions.Map.html),',
        '[map twin](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_stepfunctions.Map.html), and [data](https://docs.example.com/cdk/api/v2/data.json).',
        '[external](https://docs.aws.amazon.com/), and [local](#properties).',
        'Keep [cdn](//cdn.example.com/x), see ![img](https://docs.example.com/cdk/api/v2/docs/x.png),',
        'and see [index](https://docs.example.com/cdk/api/llms.txt).',
        '[spaced](/v2/docs/a b)',
        '[piped](https://docs.example.com/cdk/api/v2/docs/a%7Cb.html)',
        '[wiki anchor](https://en.wikipedia.org/wiki/Foo_%28bar%29)',
        'Keep [wiki](https://en.wikipedia.org/wiki/Foo_\\(bar\\)) and [pipe](https://example.com/a\\|b).',
        'Keep `[code](/v2/docs/Code)` unchanged; [escaped](https://docs.example.com/cdk/api/v2/docs/a_b.html) resolves too.',
        'See [s](https://docs.example.com/cdk/api/stability.html), [paren](https://docs.example.com/cdk/api/v2/docs/a%28b.html), [bar](https://docs.example.com/cdk/api/v2/docs/a%7Cb.html) and [shot](https://docs.example.com/cdk/api/img/Foo.PNG).',
        'Keep ``[double](/v2/docs/Double)`` unchanged.',
        'Use `new',
        'Bucket()` and see [Bucket](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html).',
        '',
      ].join('\n'));
    } finally {
      if (previousBase === undefined) {
        delete process.env.DOCS_BASE;
      } else {
        process.env.DOCS_BASE = previousBase;
      }
    }
  });

  test('handles many escaped label characters without backtracking', () => {
    const page = `[${'\\_'.repeat(40)}] text\n`;
    expect(toAgentMarkdown(page).markdown).toBe(page);
  });

  test('a stray backtick does not hide links in a later paragraph', () => {
    const page = 'Press the ` key.\n\nSee [Bucket](/v2/docs/aws-cdk-lib.aws_s3.Bucket) and `Foo`.\n';
    expect(toAgentMarkdown(page, 'https://docs.example.com/cdk/api/').markdown).toBe(
      'Press the ` key.\n\nSee [Bucket](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html) and `Foo`.\n',
    );
  });

  test('an escaped backtick does not open a code span', () => {
    const page = 'Use \\` here, see [Bucket](/v2/docs/aws-cdk-lib.aws_s3.Bucket) and `Foo`.\n';
    expect(toAgentMarkdown(page, 'https://docs.example.com/cdk/api/').markdown).toBe(
      'Use \\` here, see [Bucket](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html) and `Foo`.\n',
    );
  });

  test('an API page ending in a lowercase segment is still a page', () => {
    const page = '[pipelines](/v2/docs/aws-cdk-lib.pipelines)\n';
    expect(toAgentMarkdown(page, 'https://docs.example.com/cdk/api/').markdown).toBe(
      '[pipelines](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.pipelines.html)\n',
    );
  });

  test('recognizes the published base when DOCS_BASE differs', () => {
    const previousBase = process.env.DOCS_BASE;
    delete process.env.DOCS_BASE;
    try {
      const page = '[Bucket](/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket)\n';
      expect(toAgentMarkdown(page, 'https://docs.example.com/cdk/api/').markdown).toBe(
        '[Bucket](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html)\n',
      );
    } finally {
      if (previousBase === undefined) {
        delete process.env.DOCS_BASE;
      } else {
        process.env.DOCS_BASE = previousBase;
      }
    }
  });

  test('the twin\'s title has no word-break markup', () => {
    const page = '# <span data-pagefind-weight="10">Application<wbr>Version<wbr>Lifecycle<wbr>Config<wbr>Property</span>\n';
    expect(toAgentMarkdown(page).markdown).toBe('# ApplicationVersionLifecycleConfigProperty\n');
  });

  test('turns a container into a blockquote', () => {
    expect(markdown).toContain('> **Separate package**\n>\n> Install `@aws-cdk/aws-s3-alpha` separately.');
    expect(markdown).not.toContain(':::');
  });

  test('renders the metadata table as Markdown bullets', () => {
    const [table] = renderTypeMetadata([{
      label: 'CloudFormation',
      value: '<a href="https://example.com/resource"><code>AWS::S3::Bucket</code></a>',
    }]);
    expect(toAgentMarkdown(`${table}\n`).markdown)
      .toBe('- CloudFormation: [`AWS::S3::Bucket`](https://example.com/resource)\n');
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

  test('table-shaped documentation text remains unchanged', () => {
    const page = [
      'Use `Array<Table>` here.',
      '<table name>',
      '<table><tr><td>a</td><td>b</td></tr></table>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe(page);
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

  test('an optional property\'s display-only mark and its spoken label stay out of the Markdown', () => {
    const page = [
      '<div class="member-row" id="bucketname" data-optional="input"><div class="member-line">'
      + '<code class="member-name">bucketName</code><span class="member-optional" data-pagefind-ignore>'
      + '<span aria-hidden="true">?</span><span class="member-optional-label">optional</span></span>'
      + '<span class="member-type" data-pagefind-ignore title="string">string</span></div>',
      '<div class="member-summary">Physical name of this bucket.</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('- `bucketName`: string — Physical name of this bucket.\n');
  });

  // A member line with one variant span per language, and the flags and default outside them, as docgen emits it.
  const variantRow = (python: string) => [
    '<div class="member-row" id="bucketname"><div class="member-line">'
    + '<span class="lang-variant" data-lang="ts"><code class="member-name">bucketName</code>'
    + '<span class="member-type" data-pagefind-ignore title="string">string</span></span>'
    + `<span class="lang-variant" data-lang="python" data-pagefind-ignore>${python}</span>`
    + '<span class="member-required">required</span><span class="member-static">static</span>'
    + '<span class="member-default" data-pagefind-ignore>= "x"</span></div>',
    '<div class="member-summary">Physical name of this bucket.</div></div>',
    '',
  ].join('\n');

  test('a member row keeps the canonical name and type only, with the flags and default', () => {
    const page = variantRow('<code class="member-name">bucket_name</code>'
      + '<span class="member-type" data-pagefind-ignore title="str">str</span>');
    expect(toAgentMarkdown(page).markdown)
      .toBe('- `bucketName`: string (required) (static) = "x" — Physical name of this bucket.\n');
  });

  test('when every other language fell back on the TypeScript copy, its label still names them', () => {
    const fence = ['', '```ts', 'new Bucket(this, "B");', '```', ''];
    const page = [
      '<div class="lang-variant" data-lang="ts">', ...fence,
      '</div><div class="lang-variant" data-lang="python" data-pagefind-ignore>', ...fence,
      '</div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('TypeScript (also shown for Python):\n\n```ts\nnew Bucket(this, "B");\n```\n');
  });

  test('when one language fell back on the first copy, the first label names it and its copy is dropped', () => {
    const ts = ['', '```ts', 'new Bucket(this, "B");', '```', ''];
    const java = ['', '```java', 'new Bucket(this, "B");', '```', ''];
    const page = [
      '<div class="lang-variant" data-lang="ts">', ...ts,
      '</div><div class="lang-variant" data-lang="python" data-pagefind-ignore>', ...ts,
      '</div><div class="lang-variant" data-lang="java" data-pagefind-ignore>', ...java,
      '</div>',
      '',
    ].join('\n');
    const { markdown } = toAgentMarkdown(page);
    expect(markdown).toContain('TypeScript (also shown for Python):\n\n```ts');
    expect(markdown).toContain('Java:\n\n```java');
    expect(markdown).not.toMatch(/^Python:/m);
    expect(markdown.match(/```ts/g)).toHaveLength(1);
  });

  // An example group as docgen emits it: one `div` per language, each holding a fence.
  const exampleGroup = (copies: Array<[lang: string, fence: string, code: string, trailing?: string]>) => [
    ...copies.flatMap(([lang, fence, code, trailing = ''], i) => [
      `${i === 0 ? '' : '</div>'}<div class="lang-variant" data-lang="${lang}"${i === 0 ? '' : ' data-pagefind-ignore'}>`,
      '', `\`\`\`${fence}`, code, `${trailing}\`\`\``, '',
    ]),
    '</div>',
    '',
  ].join('\n');

  test('a fallback copy is found by its fence tag, even when its whitespace differs from the first copy', () => {
    const page = exampleGroup([
      ['ts', 'ts', 'new Bucket(this, "B");'],
      ['python', 'ts', 'new Bucket(this, "B");', '\n'],
      ['java', 'java', 'new Bucket(this, "B");'],
    ]);
    const { markdown } = toAgentMarkdown(page);
    expect(markdown).toContain('TypeScript (also shown for Python):\n\n```ts');
    expect(markdown).not.toMatch(/^Python:/m);
    expect(markdown.match(/```ts/g)).toHaveLength(1);
  });

  test('a README snippet with no translation for one language, from the real overview renderer, is labeled TypeScript', () => {
    // A tablet that translated the snippet into Python but not Java: renderReadmeBody fills Java with the TypeScript
    // source, and the twin must name that copy TypeScript rather than Java.
    const tablet = { translationsFor: () => ({ ts: 'new Bucket(this, "B");\n', python: 'Bucket(self, "B")\n' }) };
    const page = renderOverviewPage({
      title: 'm',
      types: [],
      readme: '# M\n\n```ts\nnew Bucket(this, "B");\n```\n',
      examples: { moduleFqn: 'm', languages: ['ts', 'python', 'java'], tablet: tablet as unknown as RosettaTablet },
    });
    const { markdown } = toAgentMarkdown(page);
    expect(markdown).toContain('TypeScript (also shown for Java):\n\n```ts');
    expect(markdown).toContain('Python:\n\n```python');
    expect(markdown).not.toMatch(/^Java:/m);
  });

  test('without TypeScript, a TypeScript fallback is labeled TypeScript, never another language', () => {
    const page = exampleGroup([
      ['python', 'python', 'Bucket(self, "B")'],
      ['java', 'ts', 'new Bucket(this, "B");'],
      ['go', 'ts', 'new Bucket(this, "B");'],
    ]);
    const { markdown } = toAgentMarkdown(page);
    expect(markdown).toContain('Python:\n\n```python');
    expect(markdown).toContain('TypeScript (shown for Java, Golang):\n\n```ts');
    expect(markdown).not.toMatch(/^(Java|Golang):/m);
    expect(markdown.match(/```ts/g)).toHaveLength(1);
  });

  test('without TypeScript, a fallback in the first language stands in at its place, labeled TypeScript', () => {
    const page = exampleGroup([
      ['python', 'ts', 'new Bucket(this, "B");'],
      ['java', 'java', 'new Bucket(this, "B");'],
      ['go', 'go', 'awss3.NewBucket(stack, jsii.String("B"))'],
    ]);
    const { markdown } = toAgentMarkdown(page);
    expect(markdown).not.toMatch(/^Python:/m);
    const order = ['TypeScript (shown for Python):\n\n```ts', 'Java:\n\n```java', 'Golang:\n\n```go']
      .map((label) => markdown.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('a TypeScript copy that leads with a shell fence is kept, and so is a copy whose shell fence is its own', () => {
    const page = exampleGroup([
      ['ts', 'sh', 'npm install aws-cdk-lib'],
      ['python', 'sh', 'pip install aws-cdk-lib'],
    ]);
    const { markdown } = toAgentMarkdown(page);
    expect(markdown).toContain('TypeScript:\n\n```sh\nnpm install aws-cdk-lib');
    expect(markdown).toContain('Python:\n\n```sh\npip install aws-cdk-lib');
  });

  test('without TypeScript, the head is the first language, its type a code span so a generic does not read as a tag', () => {
    const page = [
      '<div class="member-row" id="tags"><div class="member-line">'
      + '<span class="lang-variant" data-lang="java"><code class="member-name">tags</code>'
      + '<span class="member-type" data-pagefind-ignore title="List&lt;String&gt;">List&lt;String&gt;</span></span>'
      + '<span class="lang-variant" data-lang="go" data-pagefind-ignore><code class="member-name">Tags</code>'
      + '<span class="member-type" data-pagefind-ignore title="*[]*string">*[]*string</span></span>'
      + '</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('- `tags`: `List<String>`\n');
  });

  test('a method row and its parameter list keep the canonical spelling only', () => {
    const p = (lang: string, n: string) => `<span class="lang-variant" data-lang="${lang}">\`${n}\`</span>`;
    const page = '<div class="member-row" id="addrule"><div class="member-line">'
      + '<span class="lang-variant" data-lang="ts"><code class="member-signature">addRule(ruleName)</code></span>'
      + '<span class="lang-variant" data-lang="python"><code class="member-signature">add_rule(rule_name)</code></span>'
      + '</div><details class="member-disclosure"><summary>1 parameter</summary><div class="member-details">\n\n'
      + `- ${p('ts', 'ruleName')}${p('python', 'rule_name')} — The rule.\n\n</div></details></div>\n`;
    expect(toAgentMarkdown(page).markdown).toBe('- `addRule(ruleName)`\n\n  - `ruleName` — The rule.\n');
  });

  test('without TypeScript the first language is the head line', () => {
    const page = [
      '<div class="member-row" id="bucketname"><div class="member-line">'
      + '<span class="lang-variant" data-lang="python"><code class="member-name">bucket_name</code></span>'
      + '<span class="lang-variant" data-lang="java" data-pagefind-ignore><code class="member-name">bucketName</code></span>'
      + '</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('- `bucket_name`\n');
  });

  test('without TypeScript an example keeps every language and an inline name keeps the first', () => {
    const page = [
      'Call <span class="lang-variant" data-lang="python"><code>add_rule</code></span>'
      + '<span class="lang-variant" data-lang="java" data-pagefind-ignore><code>addRule</code></span>.',
      '',
      '<div class="lang-variant" data-lang="python">',
      '',
      '```python',
      'x = 1',
      '```',
      '',
      '</div><div class="lang-variant" data-lang="java" data-pagefind-ignore>',
      '',
      '```java',
      'int x = 1;',
      '```',
      '',
      '</div>',
      '',
    ].join('\n');
    const { markdown } = toAgentMarkdown(page);
    expect(markdown).toContain('Call `add_rule`.');
    expect(markdown).toContain('Python:\n\n```python\nx = 1\n```');
    expect(markdown).toContain('Java:\n\n```java\nint x = 1;\n```');
  });

  test('an inline name keeps the canonical spelling only, and two groups side by side each render once', () => {
    const v = (lang: string, text: string) => `<span class="lang-variant" data-lang="${lang}"><code>${text}</code></span>`;
    const page = `See ${v('ts', 'a')}${v('python', 'a_py')} ${v('ts', 'b')}${v('python', 'b_py')}.\n`;
    expect(toAgentMarkdown(page).markdown).toBe('See `a` `b`.\n');
  });
});
