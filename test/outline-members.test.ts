import * as spec from '@jsii/spec';
import { formatParams, nestOutlineMembers, OutlineItem } from '../docs/.vitepress/theme/outline-members.js';
import { decodeOutlineParams, encodeOutlineParams, outlineMembers, withOutlineMembers } from '../src/docgen/outline-members.js';

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

  test('carries an optional row\'s kind as extras, read from the row\'s data and not its name', () => {
    const optionalRow = (id: string, name: string, kind: string) => {
      const [, ...rest] = row(id, name);
      return [`<div class="member-row" id="${id}" data-optional="${kind}">`, ...rest];
    };
    const page = [
      '## Construct Props {#props-queueprops}',
      ...optionalRow('props-queueprops-fifo', 'fifo', 'input'),
      '## Properties {#properties}',
      ...optionalRow('deadletterqueue', 'deadLetterQueue', 'output'),
      ...row('queuearn', 'queueArn'),
    ].join('\n');
    expect(outlineMembers(page)).toEqual({
      'props-queueprops': [['props-queueprops-fifo', 'fifo', { optional: 'input' }]],
      // A required row stays a plain pair.
      'properties': [['deadletterqueue', 'deadLetterQueue', { optional: 'output' }], ['queuearn', 'queueArn']],
    });
  });

  test('a page with no member rows is left untouched', () => {
    const page = '---\ntitle: "Empty"\n---\n\n# Empty\n\n## Example {#example}\n';
    expect(withOutlineMembers(page)).toBe(page);
  });
});

/** A method row as the layout renderer emits it: the row id, the encoded parameter list and the permalink. */
function methodRow(id: string, name: string, params: string): string[] {
  const [, ...rest] = row(id, name);
  return [`<div class="member-row" id="${id}" data-params="${params}">`, ...rest];
}

const STRING: spec.TypeReference = { primitive: spec.PrimitiveType.String };

describe('method parameters in the outline', () => {
  test('encodes the parameter names in declared order, with no types, from the jsii declaration', () => {
    const encoded = encodeOutlineParams([
      { name: 'identity', type: { fqn: 'aws-cdk-lib.aws_iam.IGrantable' } },
      { name: 'objectsKeyPattern', type: { primitive: spec.PrimitiveType.Any }, optional: true },
    ]);
    expect(encoded).toBe('identity,objectsKeyPattern?');
    expect(encoded).not.toContain('IGrantable');
  });

  test('a method without parameters encodes to the empty value, so the outline renders ()', () => {
    expect(encodeOutlineParams(undefined)).toBe('');
    expect(encodeOutlineParams([])).toBe('');
    expect(decodeOutlineParams('')).toEqual([]);
  });

  test('marks a variadic parameter and reads the marks back', () => {
    const encoded = encodeOutlineParams([
      { name: 'a', type: STRING },
      { name: 'b', type: STRING, optional: true },
      { name: 'rest', type: STRING, variadic: true },
    ]);
    expect(encoded).toBe('a,b?,...rest');
    expect(decodeOutlineParams(encoded)).toEqual([{ name: 'a' }, { name: 'b', optional: true }, { name: 'rest', variadic: true }]);
  });

  test('refuses a malformed encoded parameter instead of guessing', () => {
    expect(() => decodeOutlineParams('a,,b')).toThrow(/Malformed outline parameter/);
    expect(() => decodeOutlineParams('a?b')).toThrow(/Malformed outline parameter/);
  });

  test('formats required, optional, variadic and empty parameter lists the way the outline shows them', () => {
    expect(formatParams([{ name: 'identity' }, { name: 'objectsKeyPattern', optional: true }])).toBe('(identity, objectsKeyPattern?)');
    expect(formatParams([{ name: 'statements', variadic: true }])).toBe('(...statements)');
    expect(formatParams([{ name: 'a' }, { name: 'b', optional: true }, { name: 'rest', variadic: true }])).toBe('(a, b?, ...rest)');
    expect(formatParams([])).toBe('()');
  });

  test('a method row carries its parameters as the third element, read from the row\'s data and not its signature', () => {
    const page = [
      '## Properties {#properties}',
      ...row('queuearn', 'queueArn'),
      '## Methods {#methods}',
      ...methodRow('grantsend', 'grantSend', 'grantee'),
      ...methodRow('tostring', 'toString', ''),
      ...methodRow('addtopolicy', 'addToPolicy', 'scope?,...statements'),
    ].join('\n');
    expect(outlineMembers(page)).toEqual({
      // A property row stays a plain pair.
      properties: [['queuearn', 'queueArn']],
      methods: [
        ['grantsend', 'grantSend', { params: [{ name: 'grantee' }] }],
        ['tostring', 'toString', { params: [] }],
        ['addtopolicy', 'addToPolicy', { params: [{ name: 'scope', optional: true }, { name: 'statements', variadic: true }] }],
      ],
    });
  });

  test('a row with both data attributes carries both in one extras object', () => {
    const [, ...rest] = row('x', 'x');
    const page = ['## Methods {#methods}', '<div class="member-row" id="x" data-optional="output" data-params="a">', ...rest].join('\n');
    expect(outlineMembers(page)).toEqual({ methods: [['x', 'x', { optional: 'output', params: [{ name: 'a' }] }]] });
  });

  test('the parameter list is written to the frontmatter and the body is unchanged', () => {
    const page = ['---', 'title: "Queue"', '---', '', '## Methods {#methods}', ...methodRow('grantsend', 'grantSend', 'grantee'), ''].join('\n');
    const out = withOutlineMembers(page);
    const frontmatter = out.slice(0, out.indexOf('\n---\n', 3));
    expect(frontmatter).toContain('"grantsend","grantSend",{"params":[{"name":"grantee"}]}');
    expect(out.slice(out.indexOf('\n---\n', 3))).toBe(page.slice(page.indexOf('\n---\n', 3)));
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

  test('passes an entry\'s optional kind to its item, and only a known kind', () => {
    const out = nestOutlineMembers([header('properties', 'Properties')], {
      properties: [
        ['bucketname', 'bucketName', { optional: 'input' }],
        ['encryptionkey', 'encryptionKey', { optional: 'output' }],
        ['bucketarn', 'bucketArn'],
        ['bogus', 'bogus', { optional: '<b>' as any }],
      ],
    });
    expect(out[0].children.map((c) => [c.title, c.optional])).toEqual([
      ['bucketName', 'input'],
      ['encryptionKey', 'output'],
      ['bucketArn', undefined],
      ['bogus', undefined],
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
          ['bogus', 'bogus', { params: [{ nope: 1 }] as any }],
        ],
      },
    );
    expect(out[0].children[0]).toEqual({ title: 'queueArn', link: '#queuearn', level: 3, children: [] });
    expect(out[1].children).toEqual([
      { title: 'grantSend', link: '#grantsend', level: 3, children: [], params: [{ name: 'grantee' }] },
      { title: 'toString', link: '#tostring', level: 3, children: [], params: [] },
      // A malformed list is dropped whole rather than rendered.
      { title: 'bogus', link: '#bogus', level: 3, children: [] },
    ]);
  });
});
