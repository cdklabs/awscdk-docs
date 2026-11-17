import { toAgentMarkdown } from '../src/docgen/agent-markdown.js';
import { renderOverviewPage, TypeEntry } from '../src/docgen/index.js';

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
    expect(page).toContain('## Types {#');
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

  test('a long nested name can wrap after the dot and at word boundaries without changing its text', () => {
    const entryLine = page.split('\n').find((l) => l.includes('CfnCapability'))!;
    expect(entryLine).toContain('<code>Cfn<wbr>Capability.<wbr>Edi<wbr>Configuration<wbr>Property</code>');
    expect(entryLine.replace(/<wbr>/g, '')).toContain('<code>CfnCapability.EdiConfigurationProperty</code>');
    expect(entryLine).toContain('(/v2/docs/fake.sub.CfnCapability.EdiConfigurationProperty)');
  });

  test('the table-only layout uses second-level kind headings, so the heading order stays valid', () => {
    const tableOnly = renderOverviewPage({ title: 'fake.sub', types });
    expect(tableOnly).toContain('## Constructs (L2) {#');
    expect(tableOnly).not.toContain('### ');
  });
});

describe('module type list in the Markdown twin', () => {
  const twin = toAgentMarkdown(renderOverviewPage({ title: 'fake.sub', types, readme: '# Fake\n\nProse.' })).markdown;

  test('lists each entry with its name link, kind and summary, and plain text for the name', () => {
    expect(twin).toContain('### Structs');
    expect(twin).toContain('[`CfnCapability.EdiConfigurationProperty`](/v2/docs/fake.sub.CfnCapability.EdiConfigurationProperty)');
    expect(twin).toContain('Struct');
    expect(twin).toContain('Settings for EDI.');
    expect(twin).not.toContain('<wbr>');
    expect(twin).not.toContain('<div');
  });
});
