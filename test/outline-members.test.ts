import * as spec from '@jsii/spec';
import { formatParams, nestOutlineMembers, OutlineItem } from '../docs/.vitepress/theme/outline-members.js';
import { methodOutlineExtras, outlineMembers, withOutlineMembers } from '../src/docgen/outline-members.js';

/** One member row as the layout renderers emit it: the row id and a permalink naming the member. */
function row(id: string, name: string): string[] {
  return [
    `<div class="member-row" id="${id}">`,
    `<div class="member-line"><code class="member-name">${name}</code><a class="member-permalink" href="#${id}" aria-label="Permalink to ${name}">#</a></div>`,
    '<div class="member-summary">Summary.</div>',
    '</div>',
  ];
}

const PAGE = [
  '---',
  'title: "Queue"',
  '---',
  '',
  '# Queue {#class-queue-construct}',
  '',
  '## Example {#example}',
  '',
  '```ts',
  '## Not a section {#fake}',
  '<div class="member-row" id="fake-row">',
  '<a class="member-permalink" href="#fake-row" aria-label="Permalink to fakeRow">#</a>',
  '```',
  '',
  '## Initializer {#initializer}',
  '',
  'No member rows here.',
  '',
  '## Construct Props {#props-queueprops}',
  '',
  ...row('props-queueprops-fifo', 'fifo'),
  '',
  '## Properties {#properties}',
  '',
  ...row('queuearn', 'queueArn'),
  ...row('property-injection-id', 'PROPERTY_INJECTION_ID'),
  '',
  '## Methods {#methods}',
  '',
  ...row('grantsend', 'grantSend'),
  '',
].join('\n');

describe('outline member list', () => {
  test('groups each property and method row under its section anchor, in page order, with its own row id', () => {
    const members = outlineMembers(PAGE);
    expect(members.properties).toEqual([
      ['queuearn', 'queueArn'],
      ['property-injection-id', 'PROPERTY_INJECTION_ID'],
    ]);
    expect(members.methods).toEqual([['grantsend', 'grantSend']]);
  });

  test('lists the inlined construct props under the Construct Props section anchor, with their props-based row ids', () => {
    expect(outlineMembers(PAGE)['props-queueprops']).toEqual([['props-queueprops-fifo', 'fifo']]);
    expect(Object.keys(outlineMembers(PAGE)).sort()).toEqual(['methods', 'properties', 'props-queueprops']);
  });

  test('a page without a Construct Props section gets no props group', () => {
    const page = ['## Properties {#properties}', ...row('queuearn', 'queueArn')].join('\n');
    expect(Object.keys(outlineMembers(page))).toEqual(['properties']);
  });

  test('skips headings and rows inside fenced code', () => {
    const members = outlineMembers(PAGE);
    expect(members).not.toHaveProperty('fake');
    expect(JSON.stringify(members)).not.toContain('fake-row');
  });

  test('a section with no member rows gets no group', () => {
    expect(outlineMembers(PAGE)).not.toHaveProperty('initializer');
    expect(outlineMembers(PAGE)).not.toHaveProperty('example');
  });

  test('unescapes HTML entities in the member name', () => {
    const page = ['## Methods {#methods}', ...row('tostring', 'to&lt;T&gt;')].join('\n');
    expect(outlineMembers(page)).toEqual({ methods: [['tostring', 'to<T>']] });
  });

  test('is written to the frontmatter after the declared title', () => {
    const out = withOutlineMembers(PAGE);
    const frontmatter = out.slice(0, out.indexOf('\n---\n', 3));
    expect(frontmatter.split('\n')).toEqual([
      '---',
      'title: "Queue"',
      `outlineMembers: ${JSON.stringify(outlineMembers(PAGE))}`,
    ]);
    // The body is unchanged.
    expect(out.slice(out.indexOf('\n---\n', 3))).toBe(PAGE.slice(PAGE.indexOf('\n---\n', 3)));
  });

  test('a page with no member rows is left untouched', () => {
    const page = '---\ntitle: "Empty"\n---\n\n# Empty\n\n## Example {#example}\n';
    expect(withOutlineMembers(page)).toBe(page);
  });
});

/** A jsii method declaration with just the parts the outline reads. */
function method(name: string, parameters?: spec.Parameter[]): spec.Method {
  return { name, ...(parameters ? { parameters } : {}) } as spec.Method;
}

const STRING: spec.TypeReference = { primitive: spec.PrimitiveType.String };

describe('method parameters in the outline', () => {
  test('lists the parameter names in declared order, with no types', () => {
    const extras = methodOutlineExtras(method('grantRead', [
      { name: 'identity', type: { fqn: 'aws-cdk-lib.aws_iam.IGrantable' } },
      { name: 'objectsKeyPattern', type: { primitive: spec.PrimitiveType.Any }, optional: true },
    ]));
    expect(extras).toEqual({ params: [{ name: 'identity' }, { name: 'objectsKeyPattern', optional: true }] });
    expect(JSON.stringify(extras)).not.toContain('IGrantable');
  });

  test('a method without parameters carries an empty list, so the outline renders ()', () => {
    expect(methodOutlineExtras(method('toString'))).toEqual({ params: [] });
    expect(methodOutlineExtras(method('toString', []))).toEqual({ params: [] });
  });

  test('marks a variadic parameter', () => {
    expect(methodOutlineExtras(method('addToPolicy', [{ name: 'statements', type: STRING, variadic: true }]))).toEqual({
      params: [{ name: 'statements', variadic: true }],
    });
  });

  test('formats required, optional, variadic and empty parameter lists the way the outline shows them', () => {
    expect(formatParams([{ name: 'identity' }, { name: 'objectsKeyPattern', optional: true }])).toBe('(identity, objectsKeyPattern?)');
    expect(formatParams([{ name: 'statements', variadic: true }])).toBe('(...statements)');
    expect(formatParams([{ name: 'a' }, { name: 'b', optional: true }, { name: 'rest', variadic: true }])).toBe('(a, b?, ...rest)');
    expect(formatParams([])).toBe('()');
  });

  test('a method row carries its display data as the third element; the anchor and name are unchanged', () => {
    const extras = new Map([['grantsend', methodOutlineExtras(method('grantSend', [{ name: 'grantee', type: STRING }]))]]);
    const members = outlineMembers(PAGE, extras);
    expect(members.methods).toEqual([['grantsend', 'grantSend', { params: [{ name: 'grantee' }] }]]);
    // Rows without display data keep the two-element form.
    expect(members.properties).toEqual(outlineMembers(PAGE).properties);
    expect(members['props-queueprops']).toEqual(outlineMembers(PAGE)['props-queueprops']);
  });

  test('the display data is written to the frontmatter and nowhere else in the page', () => {
    const extras = new Map([['grantsend', methodOutlineExtras(method('grantSend', [{ name: 'grantee', type: STRING }]))]]);
    const out = withOutlineMembers(PAGE, extras);
    const frontmatter = out.slice(0, out.indexOf('\n---\n', 3));
    expect(frontmatter).toContain('"grantsend","grantSend",{"params":[{"name":"grantee"}]}');
    expect(out.slice(out.indexOf('\n---\n', 3))).toBe(PAGE.slice(PAGE.indexOf('\n---\n', 3)));
  });
});

describe('outline nesting', () => {
  const header = (id: string, title: string): OutlineItem => ({ title, link: `#${id}`, level: 2, children: [] });

  test('nests each member under the matching section heading, linked to its anchor', () => {
    const out = nestOutlineMembers(
      [header('example', 'Example'), header('props-queueprops', 'Construct Props'), header('properties', 'Properties'), header('methods', 'Methods')],
      {
        'props-queueprops': [['props-queueprops-fifo', 'fifo']],
        'properties': [['queuearn', 'queueArn']],
        'methods': [['grantsend', 'grantSend']],
      },
    );
    expect(out.map((h) => [h.link, h.children.map((c) => [c.link, c.title, c.level])])).toEqual([
      ['#example', []],
      ['#props-queueprops', [['#props-queueprops-fifo', 'fifo', 3]]],
      ['#properties', [['#queuearn', 'queueArn', 3]]],
      ['#methods', [['#grantsend', 'grantSend', 3]]],
    ]);
  });

  test('leaves the headers alone when the page has no member list', () => {
    const headers = [header('properties', 'Properties')];
    expect(nestOutlineMembers(headers, undefined)).toBe(headers);
  });

  test('ignores a group whose section heading is not in the outline', () => {
    const out = nestOutlineMembers([header('methods', 'Methods')], { properties: [['queuearn', 'queueArn']] });
    expect(out[0].children).toEqual([]);
  });

  test('keeps children a heading already has, before the members', () => {
    const child = { title: 'Static', link: '#static', level: 3, children: [] };
    const out = nestOutlineMembers(
      [{ ...header('methods', 'Methods'), children: [child] }],
      { methods: [['grantsend', 'grantSend']] },
    );
    expect(out[0].children.map((c) => c.link)).toEqual(['#static', '#grantsend']);
  });

  test('carries a method entry\'s parameters onto its item and leaves the link as the row anchor', () => {
    const out = nestOutlineMembers(
      [header('properties', 'Properties'), header('methods', 'Methods')],
      {
        properties: [['queuearn', 'queueArn']],
        methods: [
          ['grantsend', 'grantSend', { params: [{ name: 'grantee' }] }],
          ['tostring', 'toString', { params: [] }],
        ],
      },
    );
    expect(out[0].children[0]).toEqual({ title: 'queueArn', link: '#queuearn', level: 3, children: [] });
    expect(out[1].children).toEqual([
      { title: 'grantSend', link: '#grantsend', level: 3, children: [], params: [{ name: 'grantee' }] },
      { title: 'toString', link: '#tostring', level: 3, children: [], params: [] },
    ]);
  });
});
