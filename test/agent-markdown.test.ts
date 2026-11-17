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

  test('keeps every language variant, each block after a label line naming its language', () => {
    expect(markdown).toContain('TypeScript:\n\n```ts\nnew Bucket(scope: Construct, id: string, props?: BucketProps)\n```');
    expect(markdown).toContain('Python:\n\n```python\nBucket(scope, id, *, versioned=None)\n```');
    expect(markdown.indexOf('TypeScript:')).toBeLessThan(markdown.indexOf('Python:'));
  });

  test('an inline name adds the other spellings once, and prose and tables appear once', () => {
    expect(markdown).toContain('| bucketArn (Python: bucket_arn) | `string` |');
    expect(markdown.match(/An S3 bucket with helpers\./g)).toHaveLength(1);
    expect(markdown.match(/\| Name \| Type \|/g)).toHaveLength(1);
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

  test('a member whose name reads differently in another language gets a sub-bullet with only its name and type', () => {
    const page = variantRow('<code class="member-name">bucket_name</code>'
      + '<span class="member-type" data-pagefind-ignore title="str">str</span>');
    // The flags and the TypeScript default stay on the head; the sub-bullet carries no TypeScript value.
    expect(toAgentMarkdown(page).markdown).toBe([
      '- `bucketName`: string (required) (static) = "x" — Physical name of this bucket.',
      '',
      '  - Python: `bucket_name`: `str`',
      '',
    ].join('\n'));
  });

  test('a member that reads the same in every language gets no sub-bullet', () => {
    const page = variantRow('<code class="member-name">bucketName</code>'
      + '<span class="member-type" data-pagefind-ignore title="string">string</span>');
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

  test('languages that spell a member the same way share one sub-bullet', () => {
    const v = (lang: string, name: string, type: string) => `<span class="lang-variant" data-lang="${lang}">`
      + `<code class="member-name">${name}</code><span class="member-type" title="${type}">${type}</span></span>`;
    const page = '<div class="member-row" id="bucket"><div class="member-line">'
      + `${v('ts', 'bucket', 'IBucket')}${v('python', 'bucket', 'IBucket')}${v('dotnet', 'Bucket', 'IBucket')}`
      + `${v('go', 'Bucket', 'IBucket')}</div></div>\n`;
    expect(toAgentMarkdown(page).markdown).toBe('- `bucket`: IBucket\n\n  - C# / .NET, Golang: `Bucket`: `IBucket`\n');
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

  test('without TypeScript, the head type is a code span, so a generic does not read as a tag', () => {
    const page = [
      '<div class="member-row" id="tags"><div class="member-line">'
      + '<span class="lang-variant" data-lang="java"><code class="member-name">tags</code>'
      + '<span class="member-type" data-pagefind-ignore title="List&lt;String&gt;">List&lt;String&gt;</span></span>'
      + '<span class="lang-variant" data-lang="go" data-pagefind-ignore><code class="member-name">Tags</code>'
      + '<span class="member-type" data-pagefind-ignore title="*[]*string">*[]*string</span></span>'
      + '</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('- `tags`: `List<String>`\n\n  - Golang: `Tags`: `*[]*string`\n');
  });

  test('a parameter list inside a member body keeps every language', () => {
    const p = (lang: string, n: string) => `<span class="lang-variant" data-lang="${lang}">\`${n}\`</span>`;
    const page = '<div class="member-row" id="addrule"><div class="member-line">'
      + '<span class="lang-variant" data-lang="ts"><code class="member-signature">addRule(ruleName)</code></span>'
      + '<span class="lang-variant" data-lang="python"><code class="member-signature">add_rule(rule_name)</code></span>'
      + '</div><details class="member-disclosure"><summary>1 parameter</summary><div class="member-details">\n\n'
      + `- ${p('ts', 'ruleName')}${p('python', 'rule_name')} — The rule.\n\n</div></details></div>\n`;
    // The whole row: the method's own Python signature is a sub-bullet, and the parameter list keeps both spellings.
    expect(toAgentMarkdown(page).markdown).toBe([
      '- `addRule(ruleName)`',
      '',
      '  - Python: `add_rule(rule_name)`',
      '',
      '  - `ruleName` (Python: `rule_name`) — The rule.',
      '',
    ].join('\n'));
  });

  describe('the language legend under the title', () => {
    const legend = (lang: string) => `> Names, types and signatures are shown in ${lang}; another language's `
      + 'spelling follows, labeled, only where it differs. Code examples are labeled by language; an unlabeled '
      + '`ts` example has no translation.';
    const v = (lang: string, text: string) => `<span class="lang-variant" data-lang="${lang}"><code>${text}</code></span>`;

    test('names the canonical language on a page with two or more', () => {
      const page = `# Bucket\n\nSee ${v('ts', 'bucketArn')}${v('python', 'bucket_arn')}.\n`;
      expect(toAgentMarkdown(page).markdown)
        .toBe(`# Bucket\n\n${legend('TypeScript')}\n\nSee \`bucketArn\` (Python: \`bucket_arn\`).\n`);
    });

    test('names the first language in a build without TypeScript', () => {
      const page = `# Bucket\n\nSee ${v('python', 'bucket_arn')}${v('java', 'bucketArn')}.\n`;
      expect(toAgentMarkdown(page).markdown)
        .toBe(`# Bucket\n\n${legend('Python')}\n\nSee \`bucket_arn\` (Java: \`bucketArn\`).\n`);
    });

    test('is left out of a one-language page', () => {
      const page = `# Bucket\n\nSee ${v('ts', 'bucketArn')}.\n`;
      expect(toAgentMarkdown(page).markdown).toBe('# Bucket\n\nSee `bucketArn`.\n');
    });

    test('an untranslated example stays a bare TypeScript fence under the legend', () => {
      const group = '<div class="lang-variant" data-lang="ts">\n\n```ts\nconst a = 1;\n```\n\n</div>'
        + '<div class="lang-variant" data-lang="python" data-pagefind-ignore>\n\n```python\na = 1\n```\n\n</div>';
      const page = `# Bucket\n\n\`\`\`ts\nnew Bucket(this, "B");\n\`\`\`\n\n${group}\n`;
      expect(toAgentMarkdown(page).markdown).toBe([
        '# Bucket', '', legend('TypeScript'), '',
        '```ts', 'new Bucket(this, "B");', '```', '',
        'TypeScript:', '', '```ts', 'const a = 1;', '```', '',
        'Python:', '', '```python', 'a = 1', '```', '',
      ].join('\n'));
    });

    test('goes under the title even when an experimental banner sits above it', () => {
      const page = `::: warning Experimental\nAlpha.\n:::\n\n# Bucket\n\nSee ${v('ts', 'bucketArn')}${v('python', 'bucket_arn')}.\n`;
      expect(toAgentMarkdown(page).markdown).toContain(`# Bucket\n\n${legend('TypeScript')}`);
    });

    test('goes under the title only, never after a `# ` comment in code', () => {
      const page = `\`\`\`python\n# a comment\n\`\`\`\n\nSee ${v('ts', 'bucketArn')}${v('python', 'bucket_arn')}.\n`;
      expect(toAgentMarkdown(page).markdown).not.toContain('> Names');
    });
  });

  test('a sub-bullet type is a code span, so a generic does not read as a tag', () => {
    const page = [
      '<div class="member-row" id="tags"><div class="member-line">'
      + '<span class="lang-variant" data-lang="ts"><code class="member-name">tags</code>'
      + '<span class="member-type" data-pagefind-ignore title="string[]">string[]</span></span>'
      + '<span class="lang-variant" data-lang="java" data-pagefind-ignore><code class="member-name">tags</code>'
      + '<span class="member-type" data-pagefind-ignore title="List&lt;String&gt;">List&lt;String&gt;</span></span>'
      + '</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('- `tags`: string[]\n\n  - Java: `tags`: `List<String>`\n');
  });

  test('languages that share an inline spelling are listed together', () => {
    const v = (lang: string, text: string) => `<span class="lang-variant" data-lang="${lang}"><code>${text}</code></span>`;
    const page = `See ${v('ts', 'bucketArn')}${v('python', 'bucket_arn')}${v('dotnet', 'BucketArn')}${v('go', 'BucketArn')}.\n`;
    expect(toAgentMarkdown(page).markdown)
      .toBe('See `bucketArn` (Python: `bucket_arn`; C# / .NET, Golang: `BucketArn`).\n');
  });

  test('without TypeScript the first language is the head line', () => {
    const page = [
      '<div class="member-row" id="bucketname"><div class="member-line">'
      + '<span class="lang-variant" data-lang="python"><code class="member-name">bucket_name</code></span>'
      + '<span class="lang-variant" data-lang="java" data-pagefind-ignore><code class="member-name">bucketName</code></span>'
      + '</div></div>',
      '',
    ].join('\n');
    expect(toAgentMarkdown(page).markdown).toBe('- `bucket_name`\n\n  - Java: `bucketName`\n');
  });

  test('without TypeScript an example and an inline name still keep every language', () => {
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
    expect(markdown).toContain('Call `add_rule` (Java: `addRule`).');
    expect(markdown).toContain('Python:\n\n```python\nx = 1\n```');
    expect(markdown).toContain('Java:\n\n```java\nint x = 1;\n```');
  });

  test('two variant groups side by side each render once', () => {
    const v = (lang: string, text: string) => `<span class="lang-variant" data-lang="${lang}"><code>${text}</code></span>`;
    const page = `${v('ts', 'a')}${v('python', 'a_py')}${v('ts', 'b')}${v('python', 'b_py')}\n`;
    expect(toAgentMarkdown(page).markdown).toBe('`a` (Python: `a_py`)`b` (Python: `b_py`)\n');
  });
});
