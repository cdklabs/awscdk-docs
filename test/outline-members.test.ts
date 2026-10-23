import * as spec from '@jsii/spec';
import { nestOutlineMembers } from '../docs/.vitepress/theme/outline-members.js';
import type { TypeIndex } from '../src/docgen/constructs.js';
import { outlineMembers, withOutlineMembers } from '../src/docgen/outline-members.js';

/** Build a minimal TypeIndex for testing - only includes the types passed in. */
function mockTypeIndex(...types: spec.Type[]): TypeIndex {
  const index = new Map();
  for (const type of types) {
    index.set(type.fqn, { type });
  }
  return index;
}

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
    expect(outlineMembers(PAGE)).toEqual({
      properties: [
        ['queuearn', 'queueArn'],
        ['property-injection-id', 'PROPERTY_INJECTION_ID'],
      ],
      methods: [['grantsend', 'grantSend']],
    });
  });

  test('leaves out the inlined construct props, which are another type\'s members', () => {
    expect(outlineMembers(PAGE)).not.toHaveProperty('props-queueprops');
    expect(JSON.stringify(outlineMembers(PAGE))).not.toContain('props-queueprops-fifo');
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
    const out = withOutlineMembers(PAGE, undefined, mockTypeIndex());
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
    expect(withOutlineMembers(page, undefined, mockTypeIndex())).toBe(page);
  });

  test('adds parameter extras to methods when a jsii type is provided', () => {
    const type: spec.ClassType = {
      kind: spec.TypeKind.Class,
      name: 'Queue',
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_sqs.Queue',
      methods: [
        { name: 'grantSend', parameters: [{ name: 'grantee', type: { fqn: 'aws-cdk-lib.aws_iam.IGrantable' } }] } as spec.Method,
      ],
    };
    const out = withOutlineMembers(PAGE, type, mockTypeIndex(type));
    const frontmatter = out.slice(0, out.indexOf('\n---\n', 3));
    const members = JSON.parse(frontmatter.split('\n')[2].replace('outlineMembers: ', ''));
    // Method entries should have parameter extras.
    expect(members.methods).toEqual([
      ['grantsend', 'grantSend', { params: [{ name: 'grantee' }] }],
    ]);
  });

  test('skips static methods when adding parameter extras', () => {
    const page = [
      '---',
      'title: "Bucket"',
      '---',
      '',
      '## Methods {#methods}',
      '',
      ...row('frombucketname', 'fromBucketName'),
      ...row('grantread', 'grantRead'),
      '',
    ].join('\n');
    const type: spec.ClassType = {
      kind: spec.TypeKind.Class,
      name: 'Bucket',
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_s3.Bucket',
      methods: [
        { name: 'fromBucketName', static: true, parameters: [{ name: 'scope', type: { fqn: 'aws-cdk-lib.Construct' } }] } as spec.Method,
        { name: 'grantRead', parameters: [{ name: 'grantee', type: { fqn: 'aws-cdk-lib.aws_iam.IGrantable' } }] } as spec.Method,
      ],
    };
    const out = withOutlineMembers(page, type, mockTypeIndex(type));
    const frontmatter = out.slice(0, out.indexOf('\n---\n', 3));
    const members = JSON.parse(frontmatter.split('\n')[2].replace('outlineMembers: ', ''));
    // Static method fromBucketName should not have params, only instance method grantRead should.
    expect(members.methods).toEqual([
      ['frombucketname', 'fromBucketName'], // no params for static
      ['grantread', 'grantRead', { params: [{ name: 'grantee' }] }],
    ]);
  });

  test('preserves properties unchanged when adding parameter extras to methods', () => {
    const type: spec.ClassType = {
      kind: spec.TypeKind.Class,
      name: 'Queue',
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_sqs.Queue',
      methods: [{ name: 'grantSend', parameters: [{ name: 'grantee', type: { fqn: 'aws-cdk-lib.aws_iam.IGrantable' } }] } as spec.Method],
    };
    const out = withOutlineMembers(PAGE, type, mockTypeIndex(type));
    const frontmatter = out.slice(0, out.indexOf('\n---\n', 3));
    const members = JSON.parse(frontmatter.split('\n')[2].replace('outlineMembers: ', ''));
    // Properties should remain unchanged (no extras).
    expect(members.properties).toEqual([
      ['queuearn', 'queueArn'],
      ['property-injection-id', 'PROPERTY_INJECTION_ID'],
    ]);
  });
});

describe('outline nesting', () => {
  const header = (id: string, title: string) => ({ title, link: `#${id}`, level: 2, children: [] });

  test('nests each member under the matching section heading, linked to its anchor', () => {
    const out = nestOutlineMembers(
      [header('example', 'Example'), header('properties', 'Properties'), header('methods', 'Methods')],
      { properties: [['queuearn', 'queueArn']], methods: [['grantsend', 'grantSend']] },
    );
    expect(out.map((h) => [h.link, h.children.map((c) => [c.link, c.title, c.level])])).toEqual([
      ['#example', []],
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

  test('renders method parameters in the outline title', () => {
    const baseChild: { title: string; link: string; level: number; children: never[] } = { title: '', link: '', level: 3, children: [] };
    const out = nestOutlineMembers(
      [{ ...header('methods', 'Methods'), children: [baseChild] }],
      { methods: [['grantread', 'grantRead', { params: [{ name: 'grantee' }, { name: 'objectsKeyPattern', optional: true }] }]] },
    );
    expect(out[0].children[1].title).toBe('grantRead(grantee, objectsKeyPattern?)');
  });

  test('renders empty parentheses for methods with no parameters', () => {
    const baseChild: { title: string; link: string; level: number; children: never[] } = { title: '', link: '', level: 3, children: [] };
    const out = nestOutlineMembers(
      [{ ...header('methods', 'Methods'), children: [baseChild] }],
      { methods: [['noparams', 'noParams', { params: [] }]] },
    );
    expect(out[0].children[1].title).toBe('noParams()');
  });

  test('renders variadic parameters with leading ...', () => {
    const baseChild: { title: string; link: string; level: number; children: never[] } = { title: '', link: '', level: 3, children: [] };
    const out = nestOutlineMembers(
      [{ ...header('methods', 'Methods'), children: [baseChild] }],
      { methods: [['add', 'add', { params: [{ name: 'items', variadic: true }] }]] },
    );
    expect(out[0].children[1].title).toBe('add(...items)');
  });

  test('renders methods without extras with name only', () => {
    const baseChild: { title: string; link: string; level: number; children: never[] } = { title: '', link: '', level: 3, children: [] };
    const out = nestOutlineMembers(
      [{ ...header('methods', 'Methods'), children: [baseChild] }],
      { methods: [['grantsend', 'grantSend']] },
    );
    expect(out[0].children[1].title).toBe('grantSend');
  });
});
