import * as spec from '@jsii/spec';
import { exampleSection, exampleTypeLinksAttr } from '../src/docgen/examples.js';

// Types in examples link to their type pages.
//
// The linking itself is done by `applyTypeLinks` in
// docs/.vitepress/type-links.ts — the same hook the generated signature
// fences use — so what docgen owns, and what these tests
// cover, is the `type-links=Name:href,…` attribute on the example fence:
// which identifiers get offered as links, which are deliberately left
// plain, and that adding the attribute never touches the code inside the
// fence (the copy button copies that text, and it must stay valid source).

/** Assembly whose symbol set holds one linkable type plus a decoy. */
const assembly = {
  name: 'aws-cdk-lib',
  version: '2.0.0',
  types: {
    'aws-cdk-lib.aws_s3.Bucket': {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_s3.Bucket',
      kind: 'class',
      name: 'Bucket',
    },
    'aws-cdk-lib.aws_s3.BucketProps': {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_s3.BucketProps',
      kind: 'interface',
      name: 'BucketProps',
      datatype: true,
    },
  },
} as unknown as spec.Assembly;

const linkFor = (fqn: string): string | undefined =>
  fqn.startsWith('aws-cdk-lib.') ? `/v2/docs/${fqn}` : undefined;

describe('example type-links attribute', () => {
  test('offers documented types and leaves everything else plain', () => {
    const code = [
      "import * as s3 from 'aws-cdk-lib/aws-s3';",
      '',
      'const bucket = new Bucket(this, \'MyBucket\', props as BucketProps);',
      'const helper = new NotAType();',
    ].join('\n');

    const attr = exampleTypeLinksAttr(code, assembly, linkFor);

    // Both documented types are offered, with base-aware page hrefs.
    expect(attr).toMatch(/^type-links=/);
    expect(attr).toContain('Bucket:/v2/docs/aws-cdk-lib.aws_s3.Bucket.html');
    expect(attr).toContain('BucketProps:/v2/docs/aws-cdk-lib.aws_s3.BucketProps.html');

    // An identifier that is not in the assembly symbol set is never offered,
    // so the hook cannot draw a guessed link for it.
    expect(attr).not.toContain('NotAType');

    // Matching is case-sensitive: the conventional local `bucket` shares its
    // spelling with the type only in lowercase and must stay plain.
    expect(attr).not.toMatch(/(^|,)bucket:/);

    // The attribute stays a single whitespace-free token — markdown-it hands
    // the fence info line to the highlight hook with inner whitespace
    // stripped, so a space would silently truncate the map.
    expect(attr).not.toMatch(/\s/);
  });

  test('does not offer a type that only appears inside a string literal', () => {
    const attr = exampleTypeLinksAttr(
      "const label = 'pass a Bucket here';",
      assembly,
      linkFor,
    );
    expect(attr).toBe('');
  });

  // Comments must be blanked before matching: a type mentioned only in prose
  // would otherwise be offered and then anchored inside the comment token.
  // Authored jsii examples are full of `// create a Bucket …` lines.
  test.each([
    ['line comment', '// create a Bucket for the app\nconst x = 1;'],
    ['block comment', '/* returns a Bucket */\nconst x = 1;'],
    ['hash comment', '# make a Bucket\nx = 1'],
  ])('does not offer a type that only appears in a %s', (_label, code) => {
    expect(exampleTypeLinksAttr(code, assembly, linkFor)).toBe('');
  });

  // The other half of the same finding: an interpolation is source, not
  // literal text, so blanking the whole backtick run dropped a real
  // reference. `${Stack.of(this).region}` is idiomatic in CDK examples.
  test('offers a type used inside a template interpolation', () => {
    const attr = exampleTypeLinksAttr('const n = `${Bucket.name}`;', assembly, linkFor);
    expect(attr).toContain('Bucket:/v2/docs/aws-cdk-lib.aws_s3.Bucket.html');
  });

  test('still ignores the literal text around a preserved interpolation', () => {
    // `Bucket` is only in the literal half; `BucketProps` is in the hole.
    const attr = exampleTypeLinksAttr(
      'const s = `a Bucket named ${BucketProps.name}`;',
      assembly,
      linkFor,
    );
    expect(attr).toContain('BucketProps:');
    expect(attr).not.toContain('Bucket:/api');
  });

  test('a comment marker inside a string does not blank the rest of the line', () => {
    // If the scan treated `//` in the URL as a comment it would blank the
    // trailing code and miss the real reference.
    const attr = exampleTypeLinksAttr(
      "const u = 'https://example.com'; const b = new Bucket();",
      assembly,
      linkFor,
    );
    expect(attr).toContain('Bucket:/v2/docs/aws-cdk-lib.aws_s3.Bucket.html');
  });

  test('drops a display name that two FQNs in the assembly share', () => {
    const ambiguous = {
      name: 'aws-cdk-lib',
      version: '2.0.0',
      types: {
        'aws-cdk-lib.aws_s3.Bucket': { fqn: 'aws-cdk-lib.aws_s3.Bucket', name: 'Bucket', kind: 'class' },
        'aws-cdk-lib.aws_other.Bucket': { fqn: 'aws-cdk-lib.aws_other.Bucket', name: 'Bucket', kind: 'class' },
      },
    } as unknown as spec.Assembly;

    // The example text cannot say which one was meant, and linking to the
    // wrong type page is worse than not linking at all.
    expect(exampleTypeLinksAttr('new Bucket();', ambiguous, linkFor)).toBe('');
  });

  test('emits nothing without a resolver, and nothing for an unresolvable type', () => {
    expect(exampleTypeLinksAttr('new Bucket();', assembly, undefined)).toBe('');
    expect(exampleTypeLinksAttr('new Bucket();', assembly, () => undefined)).toBe('');
  });
});

describe('example fence', () => {
  const bucketType = {
    assembly: 'aws-cdk-lib',
    fqn: 'aws-cdk-lib.aws_s3.Bucket',
    kind: spec.TypeKind.Class,
    name: 'Bucket',
    namespace: 'aws_s3',
    docs: { example: 'const b = new Bucket(this, \'MyBucket\');' },
  } as unknown as spec.Type;

  test('carries the attribute on the authored fence and leaves the code untouched', () => {
    const withLinks = exampleSection(bucketType, assembly, ['ts'], { linkFor });
    const fence = withLinks.find((line) => line.startsWith('```ts'))!;

    expect(fence).toContain('type-links=');
    expect(fence).toContain('Bucket:/v2/docs/aws-cdk-lib.aws_s3.Bucket.html');

    // The copy button copies the fence body, so the body must be exactly the
    // authored source — the links live in the info line and in post-highlight
    // markup, never in the code text.
    expect(withLinks).toContain('const b = new Bucket(this, \'MyBucket\');');
  });

  test('is byte-for-byte unchanged when no resolver is supplied', () => {
    expect(exampleSection(bucketType, assembly, ['ts'])).toEqual([
      '## Example {#example}',
      '',
      '```ts',
      'const b = new Bucket(this, \'MyBucket\');',
      '```',
      '',
    ]);
  });

  // The site ships five languages, so every real page takes the
  // multi-variant branch rather than the single-fence one above. The
  // attribute is computed per fence there, from that language's own snippet.
  const instantiable = {
    assembly: 'aws-cdk-lib',
    fqn: 'aws-cdk-lib.aws_s3.Bucket',
    kind: spec.TypeKind.Class,
    name: 'Bucket',
    namespace: 'aws_s3',
    initializer: {
      parameters: [
        { name: 'scope', type: { fqn: 'constructs.Construct' } },
        { name: 'id', type: { primitive: spec.PrimitiveType.String } },
      ],
    },
    // Mentions BucketProps, which the generated Python snippet cannot: that
    // asymmetry is what proves each fence's attribute comes from its own code.
    docs: { example: 'const b = new Bucket(this, \'MyBucket\', {} as BucketProps);' },
  } as unknown as spec.Type;

  test('computes the attribute per language variant, not once from the ts code', () => {
    const out = exampleSection(instantiable, assembly, ['ts', 'python'], { linkFor });
    const tsFence = out.find((line) => line.startsWith('```ts'))!;
    const pyFence = out.find((line) => line.startsWith('```python'))!;

    // The authored TypeScript names both types, so both are offered.
    expect(tsFence).toContain('Bucket:/v2/docs/aws-cdk-lib.aws_s3.Bucket.html');
    expect(tsFence).toContain('BucketProps:/v2/docs/aws-cdk-lib.aws_s3.BucketProps.html');

    // The generated Python snippet names only Bucket. If the attribute were
    // computed once from the ts code and reused, BucketProps would leak here
    // and the hook would find no such identifier to anchor.
    expect(pyFence).toContain('Bucket:/v2/docs/aws-cdk-lib.aws_s3.Bucket.html');
    expect(pyFence).not.toContain('BucketProps:');
  });

  test('leaves every variant fence info line bare when no resolver is supplied', () => {
    const out = exampleSection(instantiable, assembly, ['ts', 'python']);

    expect(out).toContain('```ts');
    expect(out).toContain('```python');
    expect(out.join('\n')).not.toContain('type-links=');
  });
});
