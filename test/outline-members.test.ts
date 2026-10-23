import { nestOutlineMembers } from '../docs/.vitepress/theme/outline-members.js';
import { outlineMembers, withOutlineMembers } from '../src/docgen/outline-members.js';

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

describe('outline nesting', () => {
  const header = (id: string, title: string) => ({ title, link: `#${id}`, level: 2, children: [] });

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
});
