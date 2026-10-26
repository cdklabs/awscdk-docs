import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from 'shiki';
import {
  NOLINK_CLASS,
  applyTypeLinks,
  codeNolinkTransformer,
  isLiteralScope,
} from '../docs/.vitepress/type-links.js';

// Type links skip strings and comments (ADR 2026-10-26-no-type-links-in-literals).
// The highlighter marks each string or comment token with NOLINK_CLASS from its
// grammar scope, and applyTypeLinks leaves those tokens alone. These tests run
// the real Shiki highlighter with the options config.mts uses.

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;
let highlighter: Highlighter;

beforeAll(async () => {
  highlighter = await createHighlighter({
    langs: ['typescript', 'python', 'java', 'csharp', 'go'],
    themes: [THEMES.light, THEMES.dark],
    engine: createJavaScriptRegexEngine(),
  });
});

function highlight(code: string, lang: string): string {
  return highlighter.codeToHtml(code, {
    lang,
    themes: THEMES,
    defaultColor: false,
    includeExplanation: 'scopeName',
    transformers: [codeNolinkTransformer as never],
  });
}

const ATTRS = 'type-links=Bucket:/v2/docs/b.html,BucketProps:/v2/docs/bp.html,RemovalPolicy:/v2/docs/rp.html';

/** The names that got an anchor, in order. */
function linked(html: string): string[] {
  return [...html.matchAll(/<a class="code-type-link" href="[^"]+">(\w+)<\/a>/g)].map((m) => m[1]);
}

/** Text of every token marked as a string or comment, joined. */
function literalText(html: string): string {
  return [...html.matchAll(new RegExp(`<span[^>]*\\bclass="${NOLINK_CLASS}"[^>]*>([^<]*)</span>`, 'g'))]
    .map((m) => m[1])
    .join('');
}

describe('type links skip strings and comments', () => {
  const cases: { lang: string; code: string; expected: string[] }[] = [
    {
      lang: 'typescript',
      code: [
        "new s3.Bucket(this, 'Bucket', {",
        '  removalPolicy: RemovalPolicy.RETAIN,',
        '  a: "say \\" Bucket",',
        '  b: `id ${Bucket.name} Bucket`,',
        "  c: 'https://x // Bucket',",
        '}); // a Bucket',
        '/* Bucket */',
      ].join('\n'),
      // The constructor, the enum, and the name inside the `${…}` hole.
      expected: ['Bucket', 'RemovalPolicy', 'Bucket'],
    },
    {
      lang: 'python',
      code: [
        's3.Bucket(self, "Bucket",',
        '    removal_policy=RemovalPolicy.RETAIN,',
        "    a='it\\'s a Bucket',",
        '    b=f"id {Bucket.x} Bucket",',
        '    c="# Bucket")  # a Bucket',
      ].join('\n'),
      expected: ['Bucket', 'RemovalPolicy', 'Bucket'],
    },
    {
      lang: 'java',
      code: [
        'Bucket.Builder.create(this, "Bucket")',
        '    .removalPolicy(RemovalPolicy.RETAIN)',
        '    .a("say \\" Bucket // Bucket")',
        '    .build(); // a Bucket',
        '/* Bucket */',
      ].join('\n'),
      expected: ['Bucket', 'RemovalPolicy'],
    },
    {
      lang: 'csharp',
      code: [
        'new Bucket(this, "Bucket", new BucketProps {',
        '    Policy = RemovalPolicy.RETAIN,',
        '    A = $"id {Bucket.Y} Bucket",',
        '    B = @"x "" Bucket // Bucket"',
        '}); // a Bucket',
        '/* Bucket */',
      ].join('\n'),
      expected: ['Bucket', 'BucketProps', 'RemovalPolicy', 'Bucket'],
    },
    {
      lang: 'go',
      code: [
        'awss3.NewBucket(stack, jsii.String("Bucket"), &awss3.BucketProps{',
        '\tRemovalPolicy: awscdk.RemovalPolicy_RETAIN,',
        '\tA: jsii.String("say \\" Bucket // Bucket"),',
        '\tB: `Bucket`,',
        '}) // a Bucket',
        '/* Bucket */',
      ].join('\n'),
      // Go spells the struct field `RemovalPolicy:`, a real identifier.
      expected: ['BucketProps', 'RemovalPolicy'],
    },
  ];

  for (const { lang, code, expected } of cases) {
    test(`${lang}: real names link; strings and comments stay plain`, () => {
      const html = applyTypeLinks(highlight(code, lang), ATTRS);
      expect(linked(html)).toEqual(expected);
      // Every string and comment was marked, including escaped quotes and a
      // comment marker inside a string.
      const literals = literalText(html);
      expect(literals).toContain('Bucket');
      expect(literals).not.toContain('code-type-link');
      // No anchor ever sits right after a quote character.
      expect(html).not.toMatch(/(['"`]|&#x27;|&quot;|&#39;)<a class="code-type-link"/);
    });
  }

  test('a signature fence still links every type', () => {
    const code = 'public static fromBucketArn(scope: Construct, id: string, bucketArn: string): IBucket';
    const html = applyTypeLinks(
      highlight(code, 'typescript'),
      'type-links=Construct:/v2/docs/c.html,IBucket:/v2/docs/ib.html',
    );
    expect(linked(html)).toEqual(['Construct', 'IBucket']);
  });

  test('a fence highlighted without the marker links as before', () => {
    // applyTypeLinks on plain Shiki output (no NOLINK_CLASS) keeps the old
    // behaviour, so a cache entry is never half-marked.
    const html = highlighter.codeToHtml("new Bucket(this, 'Bucket')", {
      lang: 'typescript',
      themes: THEMES,
      defaultColor: false,
    });
    expect(linked(applyTypeLinks(html, ATTRS))).toEqual(['Bucket', 'Bucket']);
  });

  test('the innermost scope decides: an interpolation hole is code, a quote is text', () => {
    expect(isLiteralScope(['source.ts', 'string.quoted.single.ts'])).toBe(true);
    expect(isLiteralScope(['source.ts', 'comment.line.double-slash.ts'])).toBe(true);
    expect(isLiteralScope(['source.ts', 'string.quoted.single.ts', 'punctuation.definition.string.begin.ts'])).toBe(true);
    expect(isLiteralScope([
      'source.ts', 'string.template.ts', 'meta.template.expression.ts', 'meta.embedded.line.ts', 'variable.other.object.ts',
    ])).toBe(false);
    expect(isLiteralScope(['source.cs', 'string.quoted.double.cs', 'meta.interpolation.cs', 'variable.other.object.cs'])).toBe(false);
    expect(isLiteralScope(['source.python', 'meta.fstring.python'])).toBe(false);
    expect(isLiteralScope(['source.ts', 'entity.name.function.ts'])).toBe(false);
  });

  test('the highlighted text is the code, character for character', () => {
    // Splitting merged tokens must not drop the whitespace Shiki folds into them (`declare const`).
    const code = [
      "import * as sqs from 'aws-cdk-lib/aws-sqs';",
      'declare const workgroup: redshift.CfnWorkgroup;',
      "const dlq = new sqs.Queue(this, 'DeadLetterQueue'); // a Queue",
      'x = f"{Bucket.y} Bucket"  # Bucket',
    ].join('\n');
    for (const lang of ['typescript', 'python']) {
      const html = applyTypeLinks(highlight(code, lang), ATTRS);
      const text = html
        .replace(/<span class="line">/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&#x3C;/g, '<')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      expect(text).toBe(code);
    }
  });

  test('a merged token that mixes code and text is split at the scope boundary, keeping its whitespace', () => {
    const [[a, b]] = codeNolinkTransformer.tokens([[{
      content: "x  'Bucket'",
      offset: 4,
      // Shiki can leave folded whitespace out of the parts.
      explanation: [
        { content: 'x', scopes: [{ scopeName: 'source.ts' }] },
        { content: "'Bucket'", scopes: [{ scopeName: 'source.ts' }, { scopeName: 'string.quoted.single.ts' }] },
      ],
    }]]);
    expect([a.content, a.offset, a.nolink]).toEqual(['x  ', 4, false]);
    expect([b.content, b.offset, b.nolink]).toEqual(["'Bucket'", 7, true]);
  });
});
