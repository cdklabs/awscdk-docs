import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import { buildTypeIndex } from '../src/docgen/constructs.js';
import { generateDocs } from '../src/docgen/index.js';
import { renderMethodsSection } from '../src/docgen/layout.js';
import { buildUsageIndex, renderEnumPage } from '../src/docgen/symbols.js';
import {
  canonicalLanguage,
  initializerSignatureVariants,
  isMultiLanguage,
  languageTabsOpen,
  languageVariantBlocks,
  languageVariantSpans,
  memberAnchor,
  orderedLanguages,
  typeLinksAttr,
  wrapLanguageTabs,
} from '../src/docgen/variants.js';

const ROOT = resolve(import.meta.dirname, '..');

// Model B core: one page per symbol, per-language variant
// regions embedded and toggled client-side by the shared <LanguageTabs>
// state.
describe('variant helpers', () => {
  const noLink = () => undefined;

  const method: spec.Method = {
    name: 'addToResourcePolicy',
    parameters: [{ name: 'statement', type: { primitive: spec.PrimitiveType.String } }],
    returns: { type: { primitive: spec.PrimitiveType.Boolean } },
  };

  test('languages normalize to canonical order, deduplicated', () => {
    expect(orderedLanguages(['python', 'ts', 'python'])).toEqual(['ts', 'python']);
    expect(isMultiLanguage(['ts'])).toBe(false);
    expect(isMultiLanguage(['ts', 'ts'])).toBe(false);
    expect(isMultiLanguage(['python', 'ts'])).toBe(true);
  });

  test('single language renders bare canonical output — no wrapper, no site change', () => {
    expect(languageVariantBlocks(['ts'], () => ['X']).join('\n')).not.toContain('LanguageTabs');
    expect(languageVariantSpans(['ts'], () => 'X')).toBe('X');
    expect(wrapLanguageTabs(['ts'], ['X'])).toEqual(['X']);
    // Member rows too: a single-language page carries the bare name with no
    // wrapper, and the anchor still comes from the canonical slug.
    const bare = renderMethodsSection([method], noLink, 'aws-cdk-lib.aws_s3.Bucket', ['ts']).join('\n');
    expect(bare).not.toContain('LanguageTabs');
    expect(bare).not.toContain('lang-variant');
    expect(bare).toContain(`href="#${memberAnchor(method.name)}"`);
  });

  test('memberAnchor matches the slug VitePress derives from the bare TS name', () => {
    expect(memberAnchor('addToResourcePolicy')).toBe('addtoresourcepolicy');
    expect(memberAnchor('grantRead')).toBe('grantread');
    expect(memberAnchor('toString')).toBe('tostring');
  });

  test('methods section wraps in a tabs group; parameter names flip too', () => {
    const documented: spec.Method = {
      name: 'grantRead',
      parameters: [{
        name: 'sourceBucket',
        type: { primitive: spec.PrimitiveType.String },
        docs: { summary: 'The bucket to read from.' },
      }],
    };
    const section = renderMethodsSection([documented], noLink, 'aws-cdk-lib.aws_s3.Bucket', ['ts', 'python'])
      .join('\n');
    // The whole section body sits in ONE tabs group so the shared state
    // reaches the heading and parameter-name spans.
    expect(section).toContain(languageTabsOpen(['ts', 'python']));
    // The displayed name lives INSIDE the signature: the row header carries
    // one signature per language rather than a bare name span.
    expect(section).toContain(
      '<span class="lang-variant" data-lang="ts"><code class="member-signature">'
      + '<span class="sig-name">grantRead</span>',
    );
    expect(section).toContain('v-pre><code class="member-signature">def grant_read(');
    // The anchor is the row's own permalink rather than a heading pin, and the
    // slug is the canonical one, which is what keeps existing deep links alive.
    expect(section).toContain('<div class="member-row" id="grantread">');
    expect(section).toContain('href="#grantread"');
    // Documented parameter names transliterate; the summary stays single-copy.
    expect(section).toContain('<span class="lang-variant" data-lang="ts">`sourceBucket`</span>');
    expect(section).toContain('v-pre>`source_bucket`</span>');
    expect(section.split('The bucket to read from.').length - 1).toBe(1);

    // Single language: today's bare output, no wrapper, no pinned anchor.
    const single = renderMethodsSection([documented], noLink, 'aws-cdk-lib.aws_s3.Bucket', ['ts'])
      .join('\n');
    expect(single).toContain('<div class="member-row" id="grantread">');
    expect(single).not.toContain('### grantRead');
    expect(single).toContain('- `sourceBucket` — The bucket to read from.');
  });

  test('enum Referenced-by property names flip with the language', () => {
    const colorEnum = {
      kind: 'enum',
      fqn: 'testpkg.Color',
      name: 'Color',
      assembly: 'testpkg',
      members: [{ name: 'RED' }],
    } as unknown as spec.EnumType;
    const assembly = {
      schema: 'jsii/0.10.0',
      name: 'testpkg',
      version: '1.0.0',
      types: {
        'testpkg.Color': colorEnum,
        'testpkg.Widget': {
          kind: 'class',
          fqn: 'testpkg.Widget',
          name: 'Widget',
          assembly: 'testpkg',
          properties: [{ name: 'primaryColor', type: { fqn: 'testpkg.Color' } }],
        },
      },
    } as unknown as spec.Assembly;
    const index = buildTypeIndex([assembly]);
    const usage = buildUsageIndex(index);
    const page = renderEnumPage({
      type: colorEnum, assembly, index, usage, linkFor: noLink, languages: ['ts', 'python'],
    });
    expect(page).toContain('## Referenced by');
    expect(page).toContain('<span class="lang-variant" data-lang="ts">primaryColor</span>');
    expect(page).toContain('v-pre>primary_color</span>');
    // Enum member names have no language-specific spelling — unchanged.
    expect(page).toContain('`RED`');
  });

  test('multiple languages emit one variant per language in a tabs group', () => {
    const blocks = languageVariantBlocks(['ts', 'python'], (lang) => [`content-${lang}`]).join('\n');
    expect(blocks).toContain(languageTabsOpen(['ts', 'python']));
    expect(blocks).toContain('<div class="lang-variant" data-lang="ts">');
    expect(blocks).toContain('<div class="lang-variant" data-lang="python" v-pre>');
    expect(blocks).toContain('content-ts');
    expect(blocks).toContain('content-python');
    expect(blocks).toContain('</LanguageTabs>');
  });

  // v-pre is scoped to INERT regions only: a hydrated block (the code-example
  // fences, whose Shiki output carries the runtime-wired copy-code button)
  // must not be v-pre or the button ships dead on non-canonical tabs.
  test('hydrated blocks skip v-pre', () => {
    const blocks = languageVariantBlocks(
      ['ts', 'python'],
      (lang) => [`content-${lang}`],
      { hydrated: true },
    ).join('\n');
    expect(blocks).toContain('<div class="lang-variant" data-lang="ts">');
    expect(blocks).toContain('<div class="lang-variant" data-lang="python">');
    expect(blocks).not.toContain('v-pre');
  });

  // Only the canonical variant stays hydrated; every other language's copy is
  // inert markup the Vue compiler skips.
  test('only the canonical variant is hydrated — blocks and spans', () => {
    expect(canonicalLanguage(['python', 'ts', 'go'])).toBe('ts');

    const blocks = languageVariantBlocks(['ts', 'python', 'go'], (lang) => [`content-${lang}`]).join('\n');
    expect(blocks).toContain('<div class="lang-variant" data-lang="ts">');
    expect(blocks).not.toContain('data-lang="ts" v-pre');
    expect(blocks).toContain('<div class="lang-variant" data-lang="python" v-pre>');
    expect(blocks).toContain('<div class="lang-variant" data-lang="go" v-pre>');

    const spans = languageVariantSpans(['ts', 'python'], (lang) => lang);
    expect(spans).toContain('<span class="lang-variant" data-lang="ts">ts</span>');
    expect(spans).toContain('<span class="lang-variant" data-lang="python" v-pre>python</span>');
  });

  test('canonical falls back to the first enabled language when ts is disabled', () => {
    expect(canonicalLanguage(['go', 'python'])).toBe('python');
    const blocks = languageVariantBlocks(['go', 'python'], (lang) => [`content-${lang}`]).join('\n');
    expect(blocks).toContain('<div class="lang-variant" data-lang="python">');
    expect(blocks).toContain('<div class="lang-variant" data-lang="go" v-pre>');
  });

  test('member row signatures transliterate non-TypeScript languages', () => {
    // The header line carries the signature inline, so this reads it out of
    // the row rather than out of a per-language signature block of its own.
    const out = renderMethodsSection([method], noLink, 'aws-cdk-lib.aws_s3.Bucket', ['ts', 'python', 'go'])
      .join('\n');
    // TypeScript keeps the rich cross-linked renderer…
    expect(out).toContain('<span class="sig-name">addToResourcePolicy</span>');
    // …other languages use the transliteration helpers.
    expect(out).toContain('def add_to_resource_policy(self, statement: str) -&gt; bool');
    expect(out).toContain('func AddToResourcePolicy(Statement *string) *bool');
  });

  test('initializer variants are real fenced code blocks, one per language', () => {
    const type: spec.ClassType = {
      assembly: 'testpkg',
      fqn: 'testpkg.Widget',
      kind: spec.TypeKind.Class,
      name: 'Widget',
      initializer: {
        parameters: [{ name: 'maxCount', type: { primitive: spec.PrimitiveType.Number } }],
      },
    };
    const out = initializerSignatureVariants(type, ['ts', 'python'], { linkFor: noLink }).join('\n');
    // Real markdown fences so both variants flow through the same
    // markdown-it -> Shiki pipeline as the authored `## Example` blocks —
    // NOT a hand-rolled `<pre class="signature">`.
    expect(out).toContain('```ts\nnew Widget(maxCount: number)\n```');
    expect(out).toContain('```python\nWidget(max_count: int | float)\n```');
    expect(out).not.toContain('<pre');
    // No linkable parameter type -> no type-links attribute at all.
    expect(out).not.toContain('type-links=');
    // Fences stay hydrated (no v-pre on the variant wrapper) so the Shiki
    // copy button works on the non-canonical tab too.
    expect(out).toContain('<div class="lang-variant" data-lang="python">');
    // The whole section sits in the container the responsive stylesheet targets.
    expect(out.startsWith('<div class="initializer-variants">')).toBe(true);
  });

  test('initializer fences carry inline type links via the type-links attr', () => {
    const type: spec.ClassType = {
      assembly: 'testpkg',
      fqn: 'testpkg.Widget',
      kind: spec.TypeKind.Class,
      name: 'Widget',
      initializer: {
        parameters: [
          { name: 'scope', type: { fqn: 'constructs.Construct' } },
          { name: 'id', type: { primitive: spec.PrimitiveType.String } },
          {
            name: 'props',
            optional: true,
            type: { fqn: 'testpkg.WidgetProps' },
          },
        ],
      },
    };
    const linkFor = (fqn: string) =>
      fqn === 'constructs.Construct' ? '/v2/docs/constructs.Construct'
        : fqn === 'testpkg.WidgetProps' ? '/v2/docs/testpkg.WidgetProps'
          : undefined;
    const out = initializerSignatureVariants(type, ['ts', 'python'], { linkFor }).join('\n');
    // One whitespace-free attribute maps every linkable parameter type to
    // its final href (`.html`-suffixed by pageHref); the shared highlight
    // hook turns the identifiers into anchors at VitePress build time.
    // PascalCase type names are language-invariant, so the SAME attribute
    // rides every language's fence.
    const attr = 'type-links=Construct:/v2/docs/constructs.Construct.html,WidgetProps:/v2/docs/testpkg.WidgetProps.html';
    expect(out).toContain(`\`\`\`ts ${attr}\nnew Widget(scope: Construct, id: string, props?: WidgetProps)\n\`\`\``);
    expect(out).toContain(`\`\`\`python ${attr}\nWidget(`);
    // Unlinkable types (primitives) contribute nothing.
    expect(out).not.toContain('string:');
  });

  test('typeLinksAttr reaches through collections/unions and drops ambiguous names', () => {
    const named = (fqn: string): spec.TypeReference => ({ fqn });
    const params: spec.Parameter[] = [
      {
        name: 'targets',
        type: { collection: { kind: spec.CollectionKind.Array, elementtype: named('pkg.Target') } },
      },
      {
        name: 'source',
        type: { union: { types: [named('pkg.Source'), { primitive: spec.PrimitiveType.String }] } },
      },
      // Same display name as pkg.Target but a different page — ambiguous,
      // linking either occurrence could point at the wrong type, so drop it.
      { name: 'other', type: named('otherpkg.sub.Target') },
    ];
    const linkFor = (fqn: string) => `/v2/docs/${fqn}`;
    const attr = typeLinksAttr(params, linkFor);
    expect(attr).toContain('Source:/v2/docs/pkg.Source.html');
    expect(attr).not.toContain('Target');
  });
});

describe('multi-language page generation', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'multilang-variants-'));
    generateDocs(
      { modules: ['constructs'] },
      { outDir, packageRoot: ROOT, languages: ['ts', 'python'] },
    );
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a type page embeds every enabled language, toggled by LanguageTabs', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    expect(page).toContain('<LanguageTabs :langs="[\'ts\', \'python\']">');
    // A method signature is inline in its row rather than a block, so the
    // per-language regions on a type page are spans; the block form is used
    // for fenced initializers and examples, which this page does not carry.
    expect(page).toContain('<span class="lang-variant" data-lang="ts">');
    expect(page).toContain('<span class="lang-variant" data-lang="python" v-pre>');
    // Python method signature is embedded in the same page.
    expect(page).toContain('def add_dependency(self');
  });

  // The dominant per-page artifact cost is the render-function hydration
  // chunk VitePress compiles from each page's markup. A non-canonical
  // variant is inert static markup (shown/hidden by LanguageTabs' scoped
  // CSS, never read as vnodes), so it is marked `v-pre` — the SSR compiler
  // skips it instead of re-encoding it into that chunk. Measured on a
  // 19-page subset this cut ts+python per-page JS from ~6.4 MB to ~0.44 MB
  // (~93%), which is what brings the two-language merged Pages artifact
  // back under the 1 GB Pages artifact limit. The canonical variant is left hydrated so
  // its rich cross-linked TypeScript signatures and type tooltips keep
  // working.
  test('non-canonical variants are v-pre (skip render-function compile); canonical is not', () => {
    for (const name of ['constructs.Node.md', 'constructs.Construct.md']) {
      const page = readFileSync(join(outDir, 'docs', name), 'utf-8');
      // The `## Example` and `## Initializer` sections are the HYDRATED
      // regions: their variants are fenced code blocks whose Shiki output
      // carries the runtime-wired copy-code button, which v-pre would ship
      // dead on non-canonical tabs — the initializer is on the fence path too.
      // Carve them out and assert the two regions' opposite invariants.
      let inert = page;
      const hydratedSections: string[] = [];
      for (const section of ['Example', 'Initializer']) {
        const match = new RegExp(`\\n## ${section} \\{#[^}]+\\}\\n[\\s\\S]*?(?=\\n## |$)`).exec(inert);
        if (match) {
          hydratedSections.push(match[0]);
          inert = inert.replace(match[0], '');
        }
      }

      const inertVariants = inert.match(/<(?:div|span) class="lang-variant"[^>]*>/g) ?? [];
      expect(inertVariants.length).toBeGreaterThan(0);
      for (const tag of inertVariants) {
        if (tag.includes('data-lang="ts"')) {
          // Canonical stays hydrated — no v-pre.
          expect(tag).not.toContain('v-pre');
        } else {
          // Non-canonical inert static markup — v-pre.
          expect(tag).toContain('v-pre');
        }
      }

      // Fence variants (example / initializer) are never v-pre.
      const fenceVariants = hydratedSections.join('\n').match(/<(?:div|span) class="lang-variant"[^>]*>/g) ?? [];
      for (const tag of fenceVariants) {
        expect(tag).not.toContain('v-pre');
      }
    }
  });

  test('variant markup carries no search-engine attributes', () => {
    for (const name of ['constructs.Node.md', 'constructs.Construct.md']) {
      const page = readFileSync(join(outDir, 'docs', name), 'utf-8');
      const variants = page.match(/<(?:div|span) class="lang-variant"[^>]*>/g) ?? [];
      expect(variants.length).toBeGreaterThan(0);
      for (const tag of variants) {
        expect(tag).toMatch(/^<(?:div|span) class="lang-variant" data-lang="[a-z]+"( v-pre)?>$/);
      }
      expect(page).not.toContain('data-pagefind');
    }
  });

  test('property types link on non-canonical language variants too', () => {
    // Behavioral pin at the GENERATED-PAGE level, which is what the reader
    // sees. It reads the emitted page rather than calling the renderer, so a
    // wrong row renderer fails it on behavior rather than on a missing symbol.
    const page = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');

    // Split on the LANGUAGE-AGNOSTIC marker, which is what bounds each chunk:
    // every chunk then ends where the next variant of any language begins.
    // Splitting on the per-language marker (`data-lang="python"`) lets a chunk
    // run past the TypeScript variants in between and match THEIR anchors,
    // which passes even when the row renderer is wrong. The language is
    // selected after the split, from the identifier the chunk starts with.
    const MARKER = '<span class="lang-variant" data-lang=';
    const variant = (lang: string) =>
      page
        .split(MARKER)
        .slice(1)
        .filter((chunk) => chunk.startsWith(`"${lang}"`))
        .filter((chunk) => chunk.includes('class="member-type"'));

    const python = variant('python');
    expect(python.length).toBeGreaterThan(0);

    // At least one python property type is a real link, not plain text. The
    // span also carries a `title`, so the tag is not closed
    // immediately after the class.
    expect(python.some((chunk) => /class="member-type"[^>]*><a class="sig-type"/.test(chunk))).toBe(true);

    // And the TypeScript variant is unchanged — this adds links elsewhere, it
    // does not move them.
    expect(variant('ts').some((chunk) => /class="member-type"[^>]*><a class="sig-type"/.test(chunk)))
      .toBe(true);
  });

  test('member heading anchors stay canonical while display names transliterate', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    // The DISPLAYED method name is one variant span per enabled language,
    // flipping with the shared state like signatures and props rows…
    expect(page).toContain(
      '<span class="lang-variant" data-lang="ts"><code class="member-signature">'
      + '<span class="sig-name">addDependency</span>',
    );
    expect(page).toContain('v-pre><code class="member-signature">def add_dependency(');
    // …while the ANCHOR is the canonical (TS) slug, so `#member` deep links
    // survive a client-side language switch. It lives on the row's id and
    // permalink, and the slug is deliberately the canonical one, which is what
    // keeps every existing deep link resolving.
    expect(page).toContain('<div class="member-row" id="adddependency">');
    expect(page).toContain('href="#adddependency"');
    expect(page).not.toContain('{#adddependency}');
    // No bare-text heading remains (it would double-render the TS name).
    expect(page).not.toContain('### addDependency');
    expect(page).not.toContain('### add_dependency');
  });

  test('property rows embed per-language name/type; description stays single-copy', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    expect(page).toContain('<span class="lang-variant" data-lang="ts"><code class="member-name">defaultChild</code>');
    expect(page).toContain('<span class="lang-variant" data-lang="python" v-pre><code class="member-name">default_child</code>');
  });

  test('initializer embeds a variant per language', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8');
    expect(page).toContain('## Initializer');
    expect(page).toContain('Construct(scope: Construct, id: str)');
  });

  test('language-neutral prose appears exactly once per page', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8');
    const summary = 'Returns a string representation of this construct.';
    expect(page.split(summary).length - 1).toBe(1);
  });

  test('one canonical tree only — the python variant lives in-page', () => {
    expect(existsSync(join(outDir, 'docs', 'constructs.Construct.md'))).toBe(true);
    expect(existsSync(join(outDir, 'python'))).toBe(false);
  });
});

describe('single-language generation stays wrapper-free (no site change)', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'multilang-ts-only-'));
    generateDocs(
      { modules: ['constructs'] },
      { outDir, packageRoot: ROOT, languages: ['ts'] },
    );
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('ts-only pages carry no LanguageTabs or variant markup', () => {
    for (const name of ['constructs.Construct.md', 'constructs.Node.md']) {
      const page = readFileSync(join(outDir, 'docs', name), 'utf-8');
      expect(page).not.toContain('LanguageTabs');
      expect(page).not.toContain('lang-variant');
    }
  });
});

describe('page tree is language-invariant (Model B capstone)', () => {
  // Model B's core premise: extra languages grow page SIZE, never page
  // COUNT or paths — the merged site's >=15,000-page guard needs no new
  // threshold when languages are enabled. Assert it structurally: the
  // ts-only and ts+python generations emit the exact same file tree.
  let tsOnlyDir: string;
  let multiDir: string;

  const fileTree = (root: string): string[] => {
    const files: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
        const entryRel = rel ? join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          walk(entryRel);
        } else {
          files.push(entryRel);
        }
      }
    };
    walk('');
    return files.sort();
  };

  beforeAll(() => {
    tsOnlyDir = mkdtempSync(join(tmpdir(), 'count-ts-'));
    multiDir = mkdtempSync(join(tmpdir(), 'count-multi-'));
    generateDocs({ modules: ['constructs'] }, { outDir: tsOnlyDir, packageRoot: ROOT, languages: ['ts'] });
    generateDocs({ modules: ['constructs'] }, { outDir: multiDir, packageRoot: ROOT, languages: ['ts', 'python'] });
  });

  afterAll(() => {
    rmSync(tsOnlyDir, { recursive: true, force: true });
    rmSync(multiDir, { recursive: true, force: true });
  });

  test('enabling python emits the identical file tree as ts-only', () => {
    const tsFiles = fileTree(tsOnlyDir);
    const multiFiles = fileTree(multiDir);
    expect(multiFiles).toEqual(tsFiles);
    expect(tsFiles.length).toBeGreaterThan(0);
  });
});
