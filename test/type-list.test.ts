import { tmpdir } from 'os';
import { createMarkdownRenderer } from 'vitepress';
import { toAgentMarkdown } from '../src/docgen/agent-markdown.js';
import { typeKindAnchor } from '../src/docgen/anchors.js';
import { renderOverviewPage, TypeEntry } from '../src/docgen/index.js';
import { camelBreaks } from '../src/docgen/search.js';

const entry = (name: string, kind: string, summary: string): TypeEntry => ({
  name,
  kind,
  summary,
  link: `/v2/docs/fake.sub.${name}`,
  type: {} as any,
});

const types: TypeEntry[] = [
  entry('Widget', 'Construct (L2)', 'A widget.'),
  entry('CfnWidget', 'Construct (L1)', 'A L1 widget.'),
  entry('CfnCapability.EdiConfigurationProperty', 'Struct', 'Settings for EDI.'),
  entry('Gadget', 'Class', 'A gadget.'),
  entry('Cog', 'Construct (L2)', 'A cog.'),
  entry('Bare', 'Interface', ''),
];

describe('module type list', () => {
  const page = renderOverviewPage({ title: 'fake.sub', types, readme: '# Fake\n\nProse.' });

  test('groups entries under one heading per kind, in order of first appearance', () => {
    const headings = page.split('\n').filter((l) => l.startsWith('### ')).map((l) => l.replace(/ \{#.*$/, ''));
    expect(headings).toEqual(['### Constructs (L2)', '### Constructs (L1)', '### Structs', '### Classes', '### Interfaces']);
    expect(page).toContain('## Types {#module-types}');
    expect(page).toContain('### Constructs (L2) {#module-types-constructs-l2}');
    expect(page).toContain('### Structs {#module-types-structs}');
  });

  test('keeps the entry order inside a group and shows no empty group', () => {
    const l2 = page.slice(page.indexOf('### Constructs (L2)'), page.indexOf('### Constructs (L1)'));
    expect(l2.indexOf('Widget')).toBeLessThan(l2.indexOf('Cog'));
    expect(page).not.toContain('### Enums');
  });

  test('an entry is a name link, a kind tag and the summary on the next line', () => {
    expect(page).toContain(
      '- [<code>Widget</code>](/v2/docs/fake.sub.Widget) <span class="type-kind">Construct (L2)</span><br>A widget.',
    );
  });

  test('an entry with no summary has no empty second line', () => {
    expect(page).toContain('<span class="type-kind">Interface</span>\n');
  });

  test('a long nested name can wrap after the dot without changing its text', () => {
    const entryLine = page.split('\n').find((l) => l.includes('CfnCapability'))!;
    expect(entryLine).toContain('<code>CfnCapability.<wbr>EdiConfigurationProperty</code>');
    expect(entryLine.replace(/<wbr>/g, '')).toContain('<code>CfnCapability.EdiConfigurationProperty</code>');
    expect(entryLine).toContain('(/v2/docs/fake.sub.CfnCapability.EdiConfigurationProperty)');
  });

  test('a name within the break budget carries no break points, and a part over it breaks like a page title', () => {
    const entryLine = (name: string) => renderOverviewPage({
      title: 'fake.sub',
      types: [entry(name, 'Struct', 'S.')],
      readme: '# Fake\n\nProse.',
    }).split('\n').find((l) => l.startsWith('- '))!;
    expect(entryLine('CfnWidget')).toContain('<code>CfnWidget</code>');
    const longPart = 'CfnVPCPeeringConnectionWithAnExtremelyLongGeneratedName';
    expect(longPart.length).toBeGreaterThan(32);
    expect(entryLine(`${longPart}.OptionsProperty`)).toContain(`<code>${camelBreaks(longPart)}.<wbr>OptionsProperty</code>`);
    expect(camelBreaks(longPart)).toContain('Cfn<wbr>VPC<wbr>Peering');
  });

  test('the list-only layout uses second-level kind headings, so the heading order stays valid', () => {
    const tableOnly = renderOverviewPage({ title: 'fake.sub', types });
    expect(tableOnly).toContain('## Constructs (L2) {#');
    expect(tableOnly).not.toContain('### ');
  });
});

describe('module type list in the Markdown twin', () => {
  const twin = toAgentMarkdown(renderOverviewPage({ title: 'fake.sub', types, readme: '# Fake\n\nProse.' })).markdown;

  test('lists each entry with its name link, kind and summary, and plain text for the name', () => {
    const line = twin.split('\n').find((l) => l.includes('CfnCapability.EdiConfigurationProperty'))!;
    // The name link, then the kind, then the summary, in that order on the entry's own line.
    expect(line).toMatch(
      /^- \[`CfnCapability\.EdiConfigurationProperty`\]\(\/v2\/docs\/fake\.sub\.CfnCapability\.EdiConfigurationProperty\) Struct\b.*Settings for EDI\.$/,
    );
    expect(twin).toContain('### Structs');
    expect(twin).not.toContain('<wbr>');
    expect(twin).not.toContain('<div');
    // The `{role=list}` line is browser-only markup.
    expect(twin).not.toContain('{role=list}');
    expect(twin).not.toMatch(/^\{[^}]*\}$/m);
  });
});

describe('module type list as VitePress renders it', () => {
  test('each group is a list with an explicit role, and its heading carries the kind anchor', async () => {
    const md = await createMarkdownRenderer(tmpdir());
    const source = renderOverviewPage({ title: 'fake.sub', types, readme: '# Fake\n\nProse.' }).replace(/^---\n[\s\S]*?\n---\n/, '');
    const html = md.render(source);
    expect(html).toContain('id="module-types-structs"');
    expect(html).toContain('id="module-types-constructs-l1"');
    expect(html.match(/<ul role="list">/g)).toHaveLength(5);
    expect(html).not.toContain('{role=list}');
  });
});

describe('typeKindAnchor', () => {
  test('is the module-types prefix plus the slug of the heading, the public deep link of a kind group', () => {
    expect(typeKindAnchor('Structs')).toBe('module-types-structs');
    expect(typeKindAnchor('Constructs (L1)')).toBe('module-types-constructs-l1');
    expect(typeKindAnchor('Classes')).toBe('module-types-classes');
  });
});

describe('attribute lines in the Markdown twin', () => {
  test('a standalone attribute line is dropped, but one inside a code fence is kept', () => {
    const page = ['# T', '', '- item', '{role=list}', '', '```json', '{role=list}', '```', ''].join('\n');
    const twin = toAgentMarkdown(page).markdown;
    expect(twin).toContain('- item\n');
    expect(twin.match(/\{role=list\}/g)).toHaveLength(1);
    expect(twin).toContain('```json\n{role=list}\n```');
  });
});
