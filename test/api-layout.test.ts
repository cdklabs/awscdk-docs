import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { hashedAssetPath } from './hashed-assets.js';
import { assetHash } from '../src/docgen/asset-hash.js';
import { generateDocs } from '../src/docgen/index.js';
import { renderExpandableProps, renderTypeMetadata, TypeMetadataRow } from '../src/docgen/layout.js';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Strip CSS comments before any selector lookup. A selector named in the prose
 * ABOVE a rule is indistinguishable from the rule itself to a text search, and
 * a comment explaining why some other rule exists then satisfies an assertion
 * about it — which is exactly how `expect(media).toContain('.type-tooltip')`
 * passed with the rule deleted.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The body of every declaration block whose selector LIST mentions `selector`,
 * each bounded by its own braces. A token can be declared across a shared rule
 * and its own, so the union is the honest subject; bounding each block is what
 * stops a declaration from a later rule standing in for a missing one.
 */
function blocksMentioning(css: string, selector: string): string[] {
  return css.split('}').flatMap((part) => {
    const open = part.lastIndexOf('{');
    if (open === -1) {
      return [];
    }
    // Everything after the previous rule's `}` up to this `{` is the selector
    // list — plus, in a media query, the `@media (...) {` opener, which cannot
    // contain a class selector and so cannot produce a false match.
    return part.slice(0, open).includes(selector) ? [part.slice(open + 1)] : [];
  });
}
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

describe('API page layout', () => {
  let tmp: string;
  let outDir: string;
  let publicDir: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'api-layout-'));
    outDir = join(tmp, 'modules');
    publicDir = join(tmp, 'public');
    generateDocs(
      { modules: ['aws-cdk-lib', 'constructs'] },
      { outDir, publicDir, packageRoot: ROOT, languages: ['ts'] },
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('lazy API sidebar asset', () => {
    test('emits the sidebar tree as a served static asset', () => {
      const assetFile = hashedAssetPath(join(publicDir, 'api-sidebar'), 'sidebar');
      expect(existsSync(assetFile)).toBe(true);
      const tree = JSON.parse(readFileSync(assetFile, 'utf-8'));
      expect(Array.isArray(tree)).toBe(true);
      // Framework and Services are the two top-level groupings; the Core
      // group leads Framework, grouping the foundational constructs/core/
      // assets types, and every aws_* service module sits under Services.
      // Framework headings are package-qualified module names.
      expect(tree.map((t: { text: string }) => t.text)).toEqual(['Framework', 'Services']);
      expect(tree[0].items[0].text).toBe('aws-cdk-lib');
      const frameworkSections = tree[0].items.map((s: { text: string }) => s.text);
      // `aws-cdk-lib.pipelines` is not on the curated top level: it nests under `aws-cdk-lib`, whose skeleton
      // node lists its page stem so the chunk is still found.
      expect(frameworkSections).not.toContain('aws-cdk-lib.pipelines');
      expect(tree[0].items[0].modules).toContain('aws-cdk-lib.pipelines');
      expect(frameworkSections).not.toContain('Pipelines');
      expect(frameworkSections.some((s: string) => s.startsWith('S3'))).toBe(false);
      const serviceSections = tree[1].items.map((s: { text: string }) => s.text);
      expect(serviceSections).toContain('S3');
      expect(serviceSections).toContain('Lambda');
      expect(serviceSections).not.toContain('Core');
      expect(serviceSections).not.toContain('aws-cdk-lib');
      expect(serviceSections.length).toBeGreaterThan(100);
    });

    test('the served skeleton plus its chunks reassemble the generated modules tree', () => {
      const skeleton = JSON.parse(readFileSync(hashedAssetPath(join(publicDir, 'api-sidebar'), 'sidebar'), 'utf-8'));
      const generated = JSON.parse(readFileSync(join(outDir, 'sidebar.json'), 'utf-8'));
      // The skeleton holds no section items: each section names its chunk file instead.
      const sections = [...skeleton[0].items, ...skeleton[1].items];
      expect(sections.every((s: any) => s.items === undefined && typeof s.chunk === 'string')).toBe(true);
      expect(new Set(sections.map((s: any) => s.chunk)).size).toBe(sections.length);
      // Putting every chunk back yields exactly the canonical tree.
      const rebuilt = skeleton.map((root: any) => ({
        ...root,
        items: root.items.map(({ chunk, ...section }: any) => ({
          ...section,
          items: JSON.parse(readFileSync(join(publicDir, 'api-sidebar', 'chunks', chunk), 'utf-8')),
        })),
      }));
      expect(rebuilt).toEqual(generated);
    });

    test('a section names the page stems it owns so the client can pick its chunk from the page path', () => {
      const skeleton = JSON.parse(readFileSync(hashedAssetPath(join(publicDir, 'api-sidebar'), 'sidebar'), 'utf-8'));
      const s3 = skeleton[1].items.find((s: any) => s.text === 'S3');
      expect(s3.modules).toContain('aws-cdk-lib.aws_s3');
      // Structural submodules roll into the service that owns their types.
      expect(s3.modules.some((m: string) => m.startsWith('aws-cdk-lib.interfaces.aws_s3'))).toBe(true);
      expect(s3.chunk).toMatch(/^s3\.[0-9a-f]{8}\.js$/);
      const core = skeleton[0].items.find((s: any) => s.text === 'aws-cdk-lib');
      expect(core.modules).toContain('aws-cdk-lib');
      // Chunk filenames are URL-safe, and each carries its file's content hash.
      const sections = [...skeleton[0].items, ...skeleton[1].items];
      expect(sections.every((s: any) => /^[a-z0-9._-]+\.[0-9a-f]{8}\.js$/.test(s.chunk))).toBe(true);
    });
  });

  describe('inheritance chain', () => {
    test('construct pages render a linked breadcrumb from root ancestor to self', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      expect(page).toContain('<nav class="inheritance-chain" aria-label="Type hierarchy" data-pagefind-ignore>');
      // Cross-assembly root and intermediate ancestors are clickable links
      expect(page).toContain('<a class="chain-item" href="/v2/docs/constructs.Construct.html">Construct</a>');
      expect(page).toContain('<a class="chain-item" href="/v2/docs/aws-cdk-lib.Resource.html">Resource</a>');
      // The type itself is the non-linked terminal crumb
      expect(page).toContain('<span class="chain-item chain-current">Bucket</span>');
      // Root ancestor comes before the direct parent
      expect(page.indexOf('>Construct</a>')).toBeLessThan(page.indexOf('>Resource</a>'));
    });

    test('root types without a base class still surface their implemented interfaces', () => {
      // Construct has no base class, but implements IConstruct: the
      // hierarchy bar renders with just the implements group.
      const page = readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8');
      expect(page).toContain('<nav class="inheritance-chain"');
      // The relation is a ROW beneath the breadcrumb line, not an inline
      // group appended to it.
      expect(page).toContain('<div class="chain-line"><span class="chain-item chain-current">Construct</span></div>');
      expect(page).toContain('<div class="chain-row"><span class="chain-label">implements</span>');
    });

    test('the implements list includes interfaces reached through interface inheritance', () => {
      // `Bucket` declares no interfaces of its own: `IBucket` arrives from
      // the `BucketBase` ancestor. `IBucketRef` is one level further out,
      // reached through `IBucket extends IBucketRef`, so a walk that reads
      // `interfaces` off classes alone would drop it.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      expect(page).toContain('>IBucketRef<');
      expect(page).toContain('>IBucket<');
      // Reached only through the class ancestor chain, still present.
      expect(page).toContain('>IResource<');

      // Deterministic order, pinned as an exact sequence. The set is
      // sorted by FULLY-QUALIFIED name, so the short names deliberately do
      // not read alphabetically: `aws-cdk-lib.IResource` sorts ahead of
      // `aws-cdk-lib.aws_s3.IBucket` because uppercase precedes lowercase,
      // and `constructs.*` sorts last. Asserting the exact list is what
      // documents that and what fails if the sort key ever changes —
      // membership assertions above already cover reachability.
      const impl = /<span class="chain-label">implements<\/span>(.*?)<\/nav>/s.exec(page)?.[1] ?? '';
      const names = [...impl.matchAll(/>([A-Z]\w+)</g)].map((m) => m[1]);
      expect(names).toEqual([
        'IResource',
        'IEncryptedResource',
        'IBucket',
        'IEnvironmentAware',
        'IBucketRef',
        'IConstruct',
        'IDependable',
      ]);
    });

    test('types with neither base class nor interfaces get no chain', () => {
      // Duration is a plain root class implementing nothing.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8');
      expect(page).not.toContain('inheritance-chain');
    });
  });

  describe('interface implementors', () => {
    test('an interface page lists the classes implementing it, including transitively', () => {
      // IBucketRef is the reported case: nothing declares it as
      // implemented — Bucket's chain names IBucket, which extends it.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.interfaces.aws_s3.IBucketRef.md'), 'utf-8');
      expect(page).toContain('<span class="chain-label">implemented by</span>');
      expect(page).toMatch(/>Bucket<\/a>/);
    });

    test('a widely implemented interface is capped rather than listing thousands', () => {
      // Measured on this corpus: IConstruct has over 2300 implementors,
      // against 1720 interfaces that have exactly one.
      const page = readFileSync(join(outDir, 'docs', 'constructs.IConstruct.md'), 'utf-8');
      expect(page).toContain('<span class="chain-label">implemented by</span>');
      // Truncation is the row's two-line budget rather than a fixed link
      // cap. What must not regress is that this page truncates at all and
      // says how much it hid, and that the hidden names stay reachable
      // rather than being dropped.
      const row = page.slice(page.indexOf('<span class="chain-label">implemented by'));
      const [visible] = row.split('<details');
      const shown = (visible.match(/class="chain-item"/g) ?? []).length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(30);
      expect(row).toMatch(/<summary[^>]*>[0-9,]+ more<\/summary>/);
      expect((row.match(/class="chain-item"/g) ?? []).length).toBeGreaterThan(2000);
      // Label in Name (WCAG 2.5.3): the visible `2,507 more` must appear in
      // the accessible name — `aria-label="Show 2507 more"` beside a
      // formatted visible count is a speech-input failure the axe gate
      // cannot catch, since 2.5.3 is not machine-testable. Both must come
      // from the same formatted value.
      const summary = row.match(/<summary aria-label="Show ([^"]+) more">([0-9,]+) more<\/summary>/);
      expect(summary).not.toBeNull();
      expect(summary![1]).toBe(summary![2]);
      expect(summary![2]).toContain(',');
    });
  });

  describe('struct props users', () => {
    const hierarchy = (page: string): string => {
      const start = page.indexOf('<nav class="inheritance-chain"');
      return start === -1 ? '' : page.slice(start, page.indexOf('</nav>', start));
    };

    test('a struct used as props lists its consumers as a row of the hierarchy block', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.AppProps.md'), 'utf-8');
      const block = hierarchy(page);
      expect(block).toContain(
        '<div class="chain-row" id="used-as-props-by"><span class="chain-label">used as props by</span>',
      );
      expect(block).toContain('<a class="chain-item" href="/v2/docs/aws-cdk-lib.App.html">App</a>');
      expect(page).not.toContain('## Used as props by');
    });

    test('every consumer stays linked, including those behind the overflow disclosure', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      const block = hierarchy(page);
      const row = block.slice(block.indexOf('id="used-as-props-by"'));
      expect(row).toContain('<a class="chain-item" href="/v2/docs/aws-cdk-lib.aws_s3.Bucket.html">Bucket</a>');
    });

    test('a struct no class takes as props has no props-users row or heading', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.CfnBucket.LifecycleConfigurationProperty.md'), 'utf-8');
      expect(page).not.toContain('used as props by');
      expect(page).not.toContain('Used as props by');
      expect(page).not.toContain('used-as-props-by');
    });

    test('an interface that is not a struct gets no props-users row', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.IBucket.md'), 'utf-8');
      expect(hierarchy(page)).toContain('<span class="chain-label">extends</span>');
      expect(page).not.toContain('used as props by');
    });
  });

  describe('relationship views share one vocabulary', () => {
    const css = () =>
      readFileSync(resolve(import.meta.dirname, '../docs/.vitepress/theme/api-layout.css'), 'utf-8');

    test('there is only ONE relationship container, so nothing can drift', () => {
      // Every relation is a row of ONE block. A second container kept in step
      // with a grouped selector would be a guarantee held by a copy, so this
      // asserts the stronger property: no second container exists at all.
      const rules = css();
      expect(rules).not.toContain('.subclass-list');
      expect(rules).not.toContain('.subclass-more');
      // One container also means ONE declaration of it. Slicing from the FIRST
      // occurrence alone lets a split rule set pass, with the declarations
      // that make the block a column sitting in a half the slice never reads.
      // Count, then slice.
      expect(rules.match(/^\.inheritance-chain \{/gm)).toHaveLength(1);
      expect(rules.match(/^\.inheritance-chain \.chain-row \{/gm)).toHaveLength(1);
      const surface = rules.slice(rules.indexOf('.inheritance-chain {'));
      const block = surface.slice(0, surface.indexOf('}'));
      expect(block).toContain('background-color');
      expect(block).toContain('flex-direction: column');
    });

    test('the responsive override needs only that one selector', () => {
      // A media query that narrows the bar alone shrinks it below 640px and
      // leaves the list beneath at full width. With one container there is
      // nothing left to add to the selector — assert it stays a single one.
      const rules = css();
      const media = rules.slice(rules.indexOf('@media (max-width: 640px)'));
      expect(media).toContain('.inheritance-chain {');
      expect(media).not.toMatch(/\.inheritance-chain,\s*\n\s*\./);
    });

    test('the link vocabulary is not scoped to one container', () => {
      // Scoping it to `.inheritance-chain a.chain-item` is what let the list
      // need its own copy in the first place.
      const rules = css();
      expect(rules).toMatch(/\na\.chain-item \{/);
      expect(rules).not.toContain('.inheritance-chain a.chain-item {');
    });
  });

  describe('class subclasses', () => {
    test('a construct base class lists its subclasses behind a disclosure with the honest total', () => {
      // Construct is the reported case and it routes through
      // renderConstructPage, not renderClassPage — measured at 2301
      // transitive descendants on this corpus.
      const page = readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8');
      // `superclass of` is a row of the hierarchy bar, so
      // both directions of Construct's inheritance sit in one block.
      expect(page).toContain('<span class="chain-label">superclass of</span>');
      // Honest hidden count with thousands separators, against the 2,301+
      // transitive descendants this page is the reported case for.
      const row = page.slice(page.indexOf('<span class="chain-label">superclass of'));
      expect(row).toMatch(/<summary[^>]*>[0-9,]+ more<\/summary>/);
      // Scoped to the row: `chain-item` is shared with the breadcrumb and the
      // `implements` row above it.
      const [visible] = row.split('<details');
      const shown = (visible.match(/<a class="chain-item"/g) ?? []).length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(30);
      expect((row.match(/<a class="chain-item"/g) ?? []).length).toBeGreaterThan(2000);
    });

    test('a leaf class page gets no subclasses section', () => {
      // Bucket has no descendants at all in this corpus.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      expect(page).not.toContain('## Subclasses');
    });
  });

  describe('member rows', () => {
    test('props render as chrome-less rows inside a v-pre container', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      expect(page).toContain('<div class="props-table member-list" v-pre data-pagefind-ignore>');
      expect(page).toContain('<code class="member-name">versioned</code>');
      // The type span also carries the full value in a `title`,
      // so match the opening tag rather than the whole of it.
      expect(page).toContain('<span class="member-type" title=');
      expect(page).toContain('<div class="member-summary">');
    });

    test('every member row carries an id and a named permalink', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      // The id is on the ROW, so navigating to it lands on the whole member
      // rather than on one span inside it.
      expect(page).toContain('<div class="member-row" id="versioned">');
      expect(page).toContain('<a class="member-permalink" href="#versioned"'
        + ' aria-label="Permalink to versioned">#</a>');
      // Identity is the canonical TS name, not the displayed one, so a deep
      // link survives a language switch.
      const rows = [...page.matchAll(/<div class="member-row" id="([^"]+)">/g)].map((m) => m[1]);
      expect(rows.length).toBeGreaterThan(5);
      expect(new Set(rows).size).toBe(rows.length);
      for (const id of rows) {
        expect(page).toContain(`href="#${id}"`);
      }
    });

    test('a row with extra docs expands via a disclosure beside it, not around it', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      // The header line — which carries the type's link — is a SIBLING of the
      // disclosure. Nesting it inside <summary> would be a
      // `nested-interactive` violation, so this asserts the ORDER: the line
      // closes before <details> opens.
      const row = page.slice(page.indexOf('<div class="member-row"'));
      expect(row).toMatch(
        /<div class="member-line"[^>]*>[\s\S]*?<\/div>\n(?:<div class="member-summary">[\s\S]*?<\/div>\n)?(?:<div class="member-extra">[\s\S]*?<\/div>\n)?<details class="member-disclosure">/,
      );
      expect(page).toContain('<div class="member-details">');
    });

    test('no member row nests markup inside its disclosure control', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      // The control carries a text LABEL, so an empty-summary check would not
      // express the guarantee. What must hold is that the label is only text:
      // any element inside it — above all a link — would put interactive
      // content inside a control.
      const summaries = [...page.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
      expect(summaries.length).toBeGreaterThan(0);
      for (const label of summaries) {
        expect(label).not.toMatch(/<[a-z]/i);
        expect(label.trim().length).toBeGreaterThan(0);
      }
    });

    test('the disclosure label names what it opens, and bare rows have none', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      const labels = [...page.matchAll(/<summary>([^<]+)<\/summary>/g)].map((m) => m[1]);
      expect(labels.length).toBeGreaterThan(0);
      // Derived from the contents, never jsii's own field names: "Remarks" is
      // not reader-facing vocabulary.
      for (const label of labels) {
        expect(label).not.toMatch(/remarks/i);
        expect(label).toMatch(/parameters?|returns|example|default|notes|more detail/);
      }
      // A row with nothing extra gets no control at all, which is where the
      // reclaimed space comes from — so controls must be FEWER than rows.
      const rows = (page.match(/<div class="member-row" id=/g) ?? []).length;
      expect(labels.length).toBeLessThan(rows);
    });

    test('required props render a distinct badge; optional props do not', () => {
      // FunctionProps: code, handler, and runtime are required.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_lambda.FunctionProps.md'), 'utf-8');
      // The required marker is its own styled element, present in the built
      // markup (no client JS).
      expect(page).toContain('<span class="member-required">required</span>');

      // An optional prop renders NO required marker. BucketProps.accessControl
      // is optional; render its single row in isolation and confirm the marker
      // is absent so "optional stays distinguishable from required" is pinned
      // on output, not just on the required side.
      const optionalRow = renderExpandableProps(
        [{ name: 'accessControl', type: { primitive: 'string' }, optional: true }] as any,
        () => undefined,
      ).join('\n');
      expect(optionalRow).not.toContain('member-required');

      // The marker is a badge in the stylesheet too: a filled chip, not the
      // former muted italic text. Assert on the `.member-required` block.
      const rules = withoutComments(
        readFileSync(resolve(import.meta.dirname, '../docs/.vitepress/theme/api-layout.css'), 'utf-8'),
      );
      const blocks = blocksMentioning(rules, '.member-required');
      expect(blocks.length).toBeGreaterThan(0);
      const style = blocks.join('\n');
      expect(style).toContain('background-color');
      expect(style).toContain('border-radius');
      expect(style).not.toContain('font-style: italic');
    });

    test('a value default renders inline in the header line', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      // A value default (one token, within budget) renders inline as `= value`
      // with no title and no ellipsis.
      expect(page).toMatch(/<span class="member-default">= [^<\s]+<\/span>/);
      // The inline chip never carries a space — a spaced default is prose and
      // goes on its own `Default:` line instead, not in the header.
      const inline = [...page.matchAll(/<span class="member-default">= ([^<]*)<\/span>/g)].map((m) => m[1]);
      expect(inline.length).toBeGreaterThan(0);
      for (const v of inline) {
        expect(v).not.toMatch(/\s/);
      }
    });

    /*
     * A descriptive (prose) default is shown in full on its own always-visible
     * line labelled `Default:`, not truncated and not behind the disclosure.
     */
    test('a descriptive default renders in full on a Default: line, not in the header', () => {
      const out = renderExpandableProps(
        [{
          name: 'physicalName',
          type: { primitive: 'string' },
          optional: true,
          docs: { default: 'Assigned by CloudFormation (recommended)' },
        }] as any,
        () => undefined,
      );
      const joined = out.join('\n');
      // Not in the header, and not truncated anywhere.
      expect(joined).not.toContain('member-default');
      expect(joined).not.toContain('…');
      // On an always-visible line (member-extra), not inside the disclosure.
      const extraAt = joined.indexOf('class="member-extra"');
      const detailsAt = joined.indexOf('class="member-disclosure"');
      const defaultAt = joined.indexOf('**Default:** Assigned by CloudFormation (recommended)');
      expect(extraAt).toBeGreaterThan(-1);
      expect(defaultAt).toBeGreaterThan(extraAt);
      expect(detailsAt === -1 || defaultAt < detailsAt).toBe(true);
      // Exactly one `Default:` — no duplicate between header and body.
      expect((joined.match(/\*\*Default:\*\*/g) ?? []).length).toBe(1);
    });

    /*
     * Most `@default` values in the assembly are jsii's prose form — a leading
     * `- ` meaning "no value, here is what happens instead". Rendered verbatim
     * after `= ` that reads as broken markup, and the previous assertion above
     * passes on it, so the shape needs pinning on the real corpus as well as
     * on a fixture.
     */
    test('a prose-form default loses its marker rather than rendering "= -"', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      const defaults = [...page.matchAll(/<span class="member-default">= ([^<]+)<\/span>/g)]
        .map((m) => m[1]);
      expect(defaults.length).toBeGreaterThan(0);
      for (const value of defaults) {
        expect(value).not.toMatch(/^-\s/);
      }
    });

    test('the marker is stripped, and a negative number is left alone', () => {
      const prop = (name: string, dflt: string) => ({
        name,
        type: { primitive: 'string' },
        optional: true,
        docs: { default: dflt },
      });
      const out = renderExpandableProps(
        [
          prop('displayName', '- No display name'),
          prop('offset', '-1'),
          prop('dash', '-'),
        ] as any,
        () => undefined,
      ).join('\n');
      // Header spans carry only VALUE defaults now: `-1` qualifies (one token,
      // no space); `- No display name` strips to `No display name`, which has
      // spaces and is therefore prose; a bare `-` produces nothing.
      const shown = [...out.matchAll(/<span class="member-default">= ([^<]*)<\/span>/g)]
        .map((m) => m[1]);
      expect(shown).toEqual(['-1']);
      // The stripped prose default shows in full on its own `Default:` line.
      expect(out).toContain('**Default:** No display name');
      // The bare marker earns no `Default:` line either.
      expect((out.match(/\*\*Default:\*\*/g) ?? []).length).toBe(1);
    });

    /*
     * Three properties in the assembly carry `@default -` with nothing after
     * it. The marker has to be recognized at end-of-string too, or those
     * render the bare `= -` the stripping exists to remove.
     */
    test('a default that is only the marker earns no header slot at all', () => {
      const page = readFileSync(
        join(outDir, 'docs', 'aws-cdk-lib.aws_ec2.AmazonLinuxImageProps.md'), 'utf-8');
      const at = page.indexOf('<div class="member-row" id="kernel">');
      expect(at).toBeGreaterThan(-1);
      const line = page.slice(at, page.indexOf('</div>', at));
      expect(line).toContain('>kernel</code>');
      expect(line).not.toContain('member-default');
    });

    /*
     * The value-vs-prose split is keyed on internal whitespace and the inline
     * budget. A one-token value within budget stays inline; a spaced phrase, or
     * a token past the budget, is prose on its own full `Default:` line.
     */
    test('the value-vs-prose split decides inline chip versus full Default: line', () => {
      const prop = (name: string, dflt: string) => ({
        name,
        type: { primitive: 'string' },
        optional: true,
        docs: { default: dflt },
      });
      // A spaced phrase, 24 chars: prose, shown in full, not inline.
      const phrase = 'No filtering on region!!';
      expect(phrase).toHaveLength(24);
      // A single token past the 32-char budget: prose, shown in full, not inline.
      const longToken = 'aws_cdk_lib.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE';
      expect(longToken.length).toBeGreaterThan(32);
      expect(longToken).not.toMatch(/\s/);
      // A single token within budget: value, inline.
      const value = 'RemovalPolicy.DESTROY';
      const out = renderExpandableProps(
        [prop('region', phrase), prop('policy', longToken), prop('mode', value)] as any,
        () => undefined,
      ).join('\n');
      // Only the within-budget token is an inline chip.
      const inline = [...out.matchAll(/<span class="member-default">= ([^<]*)<\/span>/g)].map((m) => m[1]);
      expect(inline).toEqual([value]);
      // Both prose defaults render in full on their own line, untruncated.
      expect(out).toContain(`**Default:** ${phrase}`);
      expect(out).toContain(`**Default:** ${longToken}`);
      expect(out).not.toContain('…');
    });

    /**
     * A jsii `@default` is a doc block, so it can span several lines and even
     * contain a blank one. A multi-line default is prose, so it renders on its
     * own `Default:` line; `defaultText` still collapses the block to one line
     * first, so a blank line cannot terminate the surrounding raw-HTML block
     * and no emitted line is left mid-markup. A single-line default never
     * exercises this, so the unit suite can be green while the docs build fails.
     */
    test('a multi-line default collapses onto a single Default: line', () => {
      const multiline = 'Default priorities:\n\n- 100 for `SetTag`\n- 200 for `RemoveTag`';
      const out = renderExpandableProps(
        [{
          name: 'priority',
          type: { primitive: 'number' },
          optional: true,
          docs: { default: multiline },
        }] as any,
        () => undefined,
      );
      // The header line is ONE line that closes itself, and carries no default
      // chip (a multi-line default is prose).
      const headers = out.filter((line) => line.includes('class="member-line"'));
      expect(headers).toHaveLength(1);
      expect(headers[0].endsWith('</div>')).toBe(true);
      expect(headers[0]).not.toContain('member-default');
      // The collapsed default is one line of prose, no raw newline survived.
      const joined = out.join('\n');
      expect(joined).toContain('**Default:** Default priorities: - 100 for `SetTag` - 200 for `RemoveTag`');
    });

    test('construct props sections use the member-row layout', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      const propsIdx = page.indexOf('## Construct Props {#props-bucketprops}');
      expect(propsIdx).toBeGreaterThan(-1);
      expect(page.indexOf('<div class="props-table member-list" v-pre data-pagefind-ignore>', propsIdx))
        .toBeGreaterThan(propsIdx);
    });
  });

  describe('methods render as member rows too', () => {
    test('a method is one row carrying its full signature inline', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      expect(page).toContain('## Methods');
      expect(page).toContain('<div class="methods-table member-list" v-pre>');
      expect(page).toMatch(/<code class="member-signature"><span class="sig-name">grantRead<\/span>/);
      // No per-member heading and no full-width signature block.
      expect(page).not.toContain('### grantRead');
      expect(page).not.toContain('<pre v-pre class="signature" data-pagefind-ignore>');
    });

    test('every parameter type and the return type stays its own link', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      // Anchored on a NAMED method: the first signature on the page may take
      // only primitives, which would make this pass or fail on ordering
      // rather than on whether parameter types are linked. grantRead takes an
      // IGrantable and returns a Grant, so both must resolve to anchors.
      const at = page.indexOf('<span class="sig-name">grantRead</span>');
      expect(at).toBeGreaterThan(-1);
      const row = page.slice(at, page.indexOf('</code>', at));
      // A signature with parameters must link more than one type, or the row
      // has collapsed the parameter types into plain text.
      const links = (row.match(/<a class="sig-type"/g) ?? []).length;
      expect(links).toBeGreaterThan(1);
    });

    test('method detail folds into the shared disclosure', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      expect(page).toContain('<details class="member-disclosure">');
      expect(page).toContain('**Parameters**');
      // The parallel method-only vocabulary is gone: one control, one body
      // surface, shared by both sections, enforced structurally.
      expect(page).not.toContain('method-details');
    });

    test('the section heading survives; per-member headings do not', () => {
      // Members carry no headings of their own. The outline keeps its section
      // entries and deep links go through the `#` permalink, which resolves
      // to the same slug a per-member heading would have produced.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      const methods = page.slice(page.indexOf('## Methods'));
      expect(methods).toContain('## Methods');
      expect(methods).not.toMatch(/^### /m);
      expect(methods).toContain('<a class="member-permalink" href="#grantread"');
    });
  });

  describe('page structure', () => {
    test('construct pages order: inheritance -> props -> properties -> methods', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
      const chain = page.indexOf('inheritance-chain');
      const props = page.indexOf('## Construct Props {#props-bucketprops}');
      const properties = page.indexOf('## Properties');
      const methods = page.indexOf('## Methods');
      expect(chain).toBeGreaterThan(-1);
      expect(chain).toBeLessThan(props);
      expect(props).toBeLessThan(properties);
      expect(properties).toBeLessThan(methods);
    });

    test('class pages put properties before methods', () => {
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.TagManager.md'), 'utf-8');
      const properties = page.indexOf('## Properties');
      const methods = page.indexOf('## Methods');
      expect(properties).toBeGreaterThan(-1);
      expect(properties).toBeLessThan(methods);
    });
  });

  describe('type-summary tooltips', () => {
    test('docgen writes a content-hashed type-summary lookup beside the api-sidebar assets', () => {
      const file = hashedAssetPath(join(publicDir, 'api-sidebar'), 'type-summaries');
      const summaries = JSON.parse(readFileSync(file, 'utf-8'));
      expect(file.endsWith(`type-summaries.${assetHash(readFileSync(file, 'utf-8'))}.js`)).toBe(true);
      expect(existsSync(join(publicDir, 'type-summaries.json'))).toBe(false);
      expect(summaries['/v2/docs/aws-cdk-lib.aws_s3.Bucket']).toEqual({
        name: 'Bucket',
        // `kind` stays the classification value: `searchKind` derives the
        // Pagefind filter from its first word, and the index tables print it.
        kind: 'Construct (L2)',
        // The reader-facing label and its level ride alongside for the hover
        // preview's chip, so the preview and the page's H1 badge
        // are the same string from the same helper.
        label: 'L2 construct',
        // The canonical `ConstructLevel`, identical to what the sidebar nav
        // data emits — one field name, one value, for one determination.
        level: 'L2',
        summary: expect.any(String),
      });
      expect(summaries['/v2/docs/aws-cdk-lib.aws_s3.BucketProps'].kind).toBe('Struct');
      expect(summaries['/v2/docs/aws-cdk-lib.aws_s3.BucketEncryption'].kind).toBe('Enum');
      // Unleveled kinds carry NEITHER field, so the file does not grow for
      // the thousands of types that have no construct level to show.
      for (const key of [
        '/v2/docs/aws-cdk-lib.aws_s3.BucketProps',
        '/v2/docs/aws-cdk-lib.aws_s3.BucketEncryption',
      ]) {
        expect(summaries[key]).not.toHaveProperty('label');
        expect(summaries[key]).not.toHaveProperty('level');
      }
    });

    test('no public dir option, no summaries file', () => {
      // The main generation above passed publicDir; a run without it must not throw
      const bare = mkdtempSync(join(tmpdir(), 'api-layout-bare-'));
      try {
        generateDocs({ modules: ['constructs'] }, { outDir: join(bare, 'modules'), packageRoot: ROOT, languages: ['ts'] });
        expect(readdirSync(bare)).toEqual(['modules']);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  describe('theme integration', () => {
    const themeEntry = () => readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    const tooltips = () => readFileSync(resolve(THEME_DIR, 'type-tooltips.ts'), 'utf-8');
    const css = () => readFileSync(resolve(THEME_DIR, 'api-layout.css'), 'utf-8');

    /*
     * The signature lives in `.member-signature`, not `pre.signature`, so the
     * `.signature`-scoped rules in signatures.css do not reach it. When only
     * some token classes carry across, a parameter default and the
     * `// chainable` badge render in the same bold primary color as the method
     * name. Pin the whole set the inline emitter can produce, so a container
     * rename cannot drop half of it.
     */
    /*
     * Judge a token on the UNION of the rules that mention it. A shared rule
     * setting only `font-weight` and the token's own color rule are separate
     * blocks, so asserting the sheet merely CONTAINS the selector passes with
     * the color rule deleted — which is how three tokens went unstyled in the
     * first place.
     */
    const rulesFor = (sheet: string, selector: string): string => {
      const bodies = blocksMentioning(withoutComments(sheet), selector);
      expect(bodies.length).toBeGreaterThan(0);
      return bodies.join('\n');
    };

    test.each([
      ['sig-param', '--vp-c-text-2'],
      ['sig-punct', '--vp-c-text-2'],
      ['sig-type', '--api-c-type'],
      ['type-param', '--sig-c-type-param'],
      ['sig-default', '--vp-c-text-2'],
      ['sig-fluent', '--vp-c-text-2'],
    ])('a member-row signature gives %s its own color and recedes it', (cls, token) => {
      const rules = rulesFor(css(), `.member-signature .${cls}`);
      expect(rules).toContain(`color: var(${token})`);
      expect(rules).toContain('font-weight: 400');
    });

    test('the identifier keeps the weight every other token gives up', () => {
      expect(rulesFor(css(), '.member-signature .sig-name')).toContain('font-weight: 600');
    });

    test('annotations are italic, so they read as notes on the signature', () => {
      for (const cls of ['type-param', 'sig-default', 'sig-fluent']) {
        expect(rulesFor(css(), `.member-signature .${cls}`)).toContain('font-style: italic');
      }
    });

    test('theme loads the api-layout stylesheet and installs tooltips', () => {
      expect(themeEntry()).toContain('./api-layout.css');
      expect(themeEntry()).toContain('installTypeTooltips');
    });

    test('tooltips fetch summaries lazily by their hashed name and are base-path aware', () => {
      expect(tooltips()).toContain('apiSidebarAsset(summariesAsset)');
      expect(tooltips()).toContain('withBase');
      expect(themeEntry()).toContain('themeConfig.typeSummariesAsset');
      expect(tooltips()).toContain('role", "tooltip');
    });

    test('tooltips are keyboard accessible', () => {
      expect(tooltips()).toContain('focusin');
      expect(tooltips()).toContain('aria-describedby');
    });

    test('tooltips are suppressed for same-page anchors and the outline', () => {
      // Heading `#` permalinks and the aside "On this page" outline are
      // excluded by container...
      expect(tooltips()).toContain('.header-anchor');
      expect(tooltips()).toContain('.VPDocAsideOutline');
      // ...and any anchor resolving to the current page is excluded by path.
      expect(tooltips()).toContain('anchor.pathname === window.location.pathname');
    });

    test('layout styles cover light and dark mode', () => {
      const lightBlock = css().slice(css().indexOf(':root {'), css().indexOf('.dark {'));
      const darkBlock = css().slice(css().indexOf('.dark {'));
      for (const variable of [
        '--api-c-type',
        '--api-c-badge-bg',
        '--api-c-badge-text',
        // The deprecated marker needs BOTH halves: `:root` and `.dark` match
        // <html> at equal specificity and this file loads after the default
        // theme, so an unshadowed `:root` color wins in dark mode and the
        // marker keeps its light-mode value on a dark background.
        '--api-c-deprecated',
      ]) {
        expect(lightBlock).toContain(`${variable}:`);
        expect(darkBlock).toContain(`${variable}:`);
      }
    });

    describe('the deprecated marker is legible in both schemes', () => {
      // The row's own surface is the page background, which custom.css sets per
      // scheme — so the contrast is computed against the value that actually
      // ships rather than an assumed white.
      const theme = () =>
        readFileSync(resolve(import.meta.dirname, '../docs/.vitepress/theme/custom.css'), 'utf-8');

      const hex = (block: string, name: string): string => {
        const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
        if (!match) {
          throw new Error(`variable ${name} not found as a hex color`);
        }
        return match[1];
      };

      const luminance = (value: string): number => {
        const channels = [1, 3, 5].map((i) => {
          const c = parseInt(value.slice(i, i + 2), 16) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };

      const contrast = (a: string, b: string): number => {
        const [la, lb] = [luminance(a), luminance(b)];
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };

      const split = (sheet: string) => ({
        light: sheet.slice(sheet.indexOf(':root {'), sheet.indexOf('.dark {')),
        dark: sheet.slice(sheet.indexOf('.dark {')),
      });

      test.each(['light', 'dark'] as const)('%s mode meets AA on the page background', (scheme) => {
        const layout = split(css())[scheme];
        const surface = split(theme())[scheme];
        expect(contrast(hex(layout, '--api-c-deprecated'), hex(surface, '--vp-c-bg')))
          .toBeGreaterThanOrEqual(4.5);
      });

      test('deprecation never depends on color alone', () => {
        // A reader who cannot distinguish the tag's hue still has the
        // strikethrough, which is why the mark is not just a color swap.
        expect(css()).toMatch(/\.member-name-deprecated \{[^}]*text-decoration: line-through/);
      });
    });

    test('layout degrades responsively on small viewports', () => {
      expect(css()).toContain('@media (max-width: 640px)');
      expect(css()).toContain('flex-direction: column');
    });

    test('generated tooltip data is gitignored', () => {
      const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('docs/public/api-sidebar/');
    });
  });

  describe('long translated types stay on one row line', () => {
    const css = () =>
      readFileSync(resolve(import.meta.dirname, '../docs/.vitepress/theme/api-layout.css'), 'utf-8');

    const declarations = (rules: string, selector: string): string => {
      // Selectors are matched wherever they appear in a GROUPED rule, not only
      // when they are the one that carries the brace — the wrapper rule below
      // covers both row shapes in one selector list.
      const at = rules.indexOf(selector);
      expect(at).toBeGreaterThan(-1);
      const open = rules.indexOf('{', at);
      return rules.slice(open, rules.indexOf('}', open));
    };

    test('the type carries the same clamp as the description', () => {
      // The row is one nowrap flex line, so an item that is not clamped
      // wraps internally and grows the line box instead: `int | float`
      // (Python's spelling of jsii `number`) broke onto a second line while
      // the summary beside it stayed one. The clamp is scoped to the
      // table because the bare `.prop-type` rule is shared with signature
      // rendering, which has no line to clamp to.
      const rules = css();
      const type = declarations(rules, '.member-list .member-type');
      // The summary is allowed to wrap and carries no clamp, so there is no
      // second rule to compare against. The type's own declarations are the
      // claim.
      for (const decl of ['min-width: 0', 'overflow: hidden', 'white-space: nowrap', 'text-overflow: ellipsis']) {
        expect(type).toContain(decl);
      }
      // Without a definite display the clamp is inert: `overflow` and
      // `text-overflow` do nothing on a non-replaced inline box, which is
      // what `.prop-type` is inside the shipped multi-language row.
      expect(type).toContain('display: inline-block');
      // And inline-block alone still needs a ceiling to ellipsize against.
      expect(type).toContain('max-width: 100%');
    });

    test('the name keeps a gap from the type that follows it', () => {
      expect(declarations(css(), '.member-list .member-name')).toContain('margin-right: 8px');
    });

    test('the language-variant wrapper holds the name and type on one line', () => {
      // The row grew in the multi-language shape because the line BROKE
      // between the name and the type — measured with the type at the same x
      // as the name, one line below it — not because the type wrapped
      // internally. `min-width: 0` then lets the span shrink past its content
      // so the type has a width to clamp to. No clip is needed here: without a
      // right-hand control there is no gutter to protect.
      const wrapper = declarations(css(), '.member-list .member-line > .lang-variant');
      expect(wrapper).toContain('white-space: nowrap');
      expect(wrapper).toContain('min-width: 0');
      // It must NOT become a flex container: that blockifies the name `code`
      // beside it, whose height then comes from line-height rather than the
      // font, growing every row by 4px and pushing the disclosure control off
      // center against the tolerance the member-row e2e spec asserts.
      expect(wrapper).not.toMatch(/display: (inline-)?flex/);
    });

    test('the summary sits in its own block, so it never shares the line with the type', () => {
      // With the summary and the type on one line, the shrink has to be
      // weighted so a long description yields before the type clamps. The
      // summary sits in its own block instead, which removes the competition
      // rather than tuning it — so it must NOT be inside the header line, and
      // must carry no clamp of its own, being free to wrap.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      expect(page).toMatch(/<\/div>\n<div class="member-summary">/);
      expect(page).not.toMatch(/<div class="member-line"[^>]*>[^\n]*<div class="member-summary">/);
      const summary = declarations(css(), '.member-summary');
      expect(summary).not.toContain('white-space: nowrap');
      expect(summary).not.toContain('text-overflow: ellipsis');
    });

    test('every clamp is released where the row stacks', () => {
      // A stacked row has no single line to clamp to, so a clamp left on
      // would ellipsize a value that has a whole line to itself. The wrapper
      // needs releasing too, or its own nowrap and clip survive the stack.
      const media = withoutComments(css().slice(css().indexOf('@media (max-width: 640px)')));

      // The union of every DECLARATION BLOCK whose selector list mentions this
      // selector. Searching the raw text instead is how three assertions in
      // this file came to prove nothing: a selector named in a nearby COMMENT
      // satisfied the match, and an unbounded slice let a declaration from a
      // later rule stand in for the one under test.
      const blockFor = (selector: string): string => {
        const bodies = blocksMentioning(media, selector);
        expect(bodies.length).toBeGreaterThan(0);
        return bodies.join('\n');
      };

      for (const selector of ['.member-list .member-type', '.member-list .member-default']) {
        const block = blockFor(selector);
        expect(block).toContain('white-space: normal');
        expect(block).toContain('overflow: visible');
      }

      // The default's clamp is a `ch` measure rather than the type's
      // `max-width: 100%`, so it keeps truncating even once the text may wrap —
      // and below this breakpoint its `title` recovery is unusable, because the
      // same media block switches hover tooltips off for touch.
      expect(blockFor('.member-list .member-default')).toContain('max-width: none');
      expect(blockFor('.type-tooltip')).toContain('display: none');

      expect(blockFor('.member-list .member-line > .lang-variant'))
        .toContain('white-space: normal');
    });

    test('the clamped type keeps its full value in a title', () => {
      // Clipping is visual only: the row is the only place the type appears,
      // so an ellipsis with nothing behind it would lose the information.
      // This fixture generates TypeScript alone; the translated spellings are
      // asserted in the e2e spec, against the five-language build that ships.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      const typed = [...page.matchAll(/<span class="member-type"([^>]*)>/g)];
      expect(typed.length).toBeGreaterThan(0);
      for (const span of typed) {
        expect(span[1]).toMatch(/ title="[^"]+"/);
      }
    });

    test('a clamped type keeps every link it had', () => {
      // The anchors are children of the clamped box, so truncation must not
      // change an href — the type stays a way to navigate.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      const inType = page.slice(page.indexOf('<span class="member-type'));
      expect(inType).toContain('<a class="sig-type" title="" href="');
    });

    test('a linked type does not show two tooltips at once', () => {
      // A native `title` is inherited by descendants, and `type-tooltips.ts`
      // already renders a hover card for any link into the API docs — so the
      // span's title has to be blanked over the anchors or every linked type
      // in every props table shows the browser bubble on top of the card.
      // Scoped to the type spans: signature anchors have no titled ancestor
      // and are deliberately left alone.
      const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
      const spans = [...page.matchAll(/<span class="member-type"[^>]*>(.*?)<\/span>/g)]
        .map((m) => m[1])
        .filter((inner) => inner.includes('<a class="sig-type"'));
      expect(spans.length).toBeGreaterThan(0);
      for (const inner of spans) {
        for (const anchor of inner.matchAll(/<a class="sig-type"([^>]*)>/g)) {
          expect(anchor[1]).toContain('title=""');
        }
      }
    });
  });
});

describe('renderTypeMetadata', () => {
  test('no rows renders nothing at all -- not an empty container', () => {
    // A page with no provenance must emit no markup at all, which is what
    // lets the six renderers call the emitter unconditionally.
    expect(renderTypeMetadata([])).toEqual([]);
  });

  test('a fourth row is just a row -- the emitter is not arity-bound', () => {
    // The extensibility claim, asserted at the emitter rather than only as the
    // absence of position-keyed CSS.
    const rows: TypeMetadataRow[] = [
      { label: 'CloudFormation', value: '<code>AWS::S3::Bucket</code>' },
      { label: 'L1 type', value: '<code>CfnBucket</code>' },
      { label: 'Source', value: '<a href="https://example.com/x.ts#L1">Source</a>' },
      { label: 'Since', value: '<code>2.100.0</code>' },
    ];
    const [html, blank] = renderTypeMetadata(rows);
    expect(blank).toBe('');
    // Every row present, in the order given, as a dt/dd pair.
    expect([...html.matchAll(/<dt class="type-metadata-label">([^<]*)<\/dt>/g)].map((m) => m[1]))
      .toEqual(['CloudFormation', 'L1 type', 'Source', 'Since']);
    expect((html.match(/<dd class="type-metadata-value">/g) ?? [])).toHaveLength(4);
    // One container, not one per row.
    expect((html.match(/<dl /g) ?? [])).toHaveLength(1);
    expect(html).toContain('aria-label="Type metadata"');
  });

  test('labels are escaped and values are passed through as the pre-escaped HTML they are', () => {
    // The asymmetry is deliberate and is the emitter's contract: a label is
    // text, a value is markup the caller already escaped. Stating it here means
    // a later change to either side has to change this test on purpose.
    const [html] = renderTypeMetadata([{ label: 'A & B', value: '<code>x &amp; y</code>' }]);
    expect(html).toContain('<dt class="type-metadata-label">A &amp; B</dt>');
    expect(html).toContain('<dd class="type-metadata-value"><code>x &amp; y</code></dd>');
  });
});
