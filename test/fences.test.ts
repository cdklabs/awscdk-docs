import { codeFence, FenceSpan, mapProse, tokenizeFences } from '../src/docgen/fences.js';

/** Reassemble span texts the way every consumer does. */
function rejoin(spans: FenceSpan[]): string {
  return spans.map((s) => s.text).join('\n');
}

describe('tokenizeFences', () => {
  test('splits prose and code, reconstructing the input exactly', () => {
    const md = 'intro\n\n```ts\nconst a = 1;\n```\n\noutro';
    const spans = tokenizeFences(md);
    expect(spans.map((s) => s.kind)).toEqual(['prose', 'code', 'prose']);
    expect(spans[1]).toMatchObject({
      marker: '`',
      run: 3,
      indent: 0,
      info: 'ts',
      closed: true,
      text: '```ts\nconst a = 1;\n```',
    });
    expect(rejoin(spans)).toBe(md);
  });

  test('a backtick line inside a tilde fence is body, not a boundary', () => {
    const md = '~~~\n```\nstill inside\n~~~\nafter';
    const spans = tokenizeFences(md);
    expect(spans.map((s) => s.kind)).toEqual(['code', 'prose']);
    expect(spans[0].closed).toBe(true);
    expect(spans[0].text).toBe('~~~\n```\nstill inside\n~~~');
    expect(rejoin(spans)).toBe(md);
  });

  test('a fence closes only on a run at least as long as its opener', () => {
    const md = '````\n```\ninner\n````\nafter';
    const spans = tokenizeFences(md);
    expect(spans[0]).toMatchObject({ kind: 'code', run: 4, closed: true });
    expect(spans[0].text).toContain('inner');
  });

  test('a closer with an info string does not close', () => {
    const spans = tokenizeFences('```\nbody\n```ts\nstill body\n```');
    expect(spans).toHaveLength(1);
    expect(spans[0].closed).toBe(true);
  });

  test('a four-space-indented marker is an indented code block, not a fence', () => {
    const md = 'prose\n\n    ```\n    indented code\n\nmore prose';
    const spans = tokenizeFences(md);
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe('prose');
  });

  test('an up-to-three-space-indented marker opens a fence', () => {
    const spans = tokenizeFences(' ```ts\ncode\n```');
    expect(spans[0]).toMatchObject({ kind: 'code', indent: 1, closed: true });
  });

  test('a blockquoted fence is code', () => {
    const md = '> before\n> ```json\n> { "a": 1 }\n> ```\n> after';
    const spans = tokenizeFences(md);
    expect(spans.map((s) => s.kind)).toEqual(['prose', 'code', 'prose']);
    expect(spans[1].text).toBe('> ```json\n> { "a": 1 }\n> ```');
    expect(rejoin(spans)).toBe(md);
  });

  test('a quoted fence is not closed by a fence outside the blockquote', () => {
    const md = '> ```js\n> quoted();\n> ```ts\n> still quoted\n> ```\nafter';
    const spans = tokenizeFences(md);
    expect(spans[0]).toMatchObject({ kind: 'code', closed: true });
    expect(spans[0].text).toContain('still quoted');
    expect(spans[1]).toMatchObject({ kind: 'prose', text: 'after' });
  });

  test('a quoted line inside a column-0 fence body is not its closer', () => {
    const md = '```\ncontent\n> ```\nmore content\n```';
    const spans = tokenizeFences(md);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ kind: 'code', closed: true, text: md });
  });

  test('an unclosed quoted fence ends with its blockquote', () => {
    const md = '> Note:\n> ```js\n> quoted();\n\nReal prose with {braces}.\n\n```ts\nlifted();\n```';
    const spans = tokenizeFences(md);
    expect(spans.map((s) => s.kind)).toEqual(['prose', 'code', 'prose', 'code']);
    expect(spans[1]).toMatchObject({ closed: false, depth: 1, text: '> ```js\n> quoted();' });
    expect(spans[2].text).toContain('Real prose');
    expect(spans[3]).toMatchObject({ indent: 0, info: 'ts', closed: true, depth: 0 });
    expect(rejoin(spans)).toBe(md);
  });

  test('an unclosed fence runs to the end and reports closed: false', () => {
    const spans = tokenizeFences('prose\n```ts\ndangling');
    expect(spans[1]).toMatchObject({ kind: 'code', closed: false, marker: '`', run: 3 });
    expect(spans[1].text).toBe('```ts\ndangling');
  });

  test('empty input yields no spans', () => {
    expect(tokenizeFences('')).toEqual([{ kind: 'prose', text: '' }]);
  });
});

describe('mapProse', () => {
  test('transforms prose but not fenced blocks or inline code', () => {
    const md = 'a {x} `b {y}`\n```\nc {z}\n```\nd {w}';
    const out = mapProse(md, (p) => p.replace(/\{/g, '('));
    expect(out).toBe('a (x} `b {y}`\n```\nc {z}\n```\nd (w}');
  });

  test('protects a backtick span inside a tilde fence body', () => {
    const md = '~~~\n```{inner}\n~~~\n{outer}';
    expect(mapProse(md, (p) => p.replace(/\{/g, '('))).toBe('~~~\n```{inner}\n~~~\n(outer}');
  });
});

describe('codeFence', () => {
  test('uses a triple-backtick fence for code without backticks', () => {
    expect(codeFence('const a = 1;\nconst b = 2;', 'ts')).toEqual(['```ts', 'const a = 1;\nconst b = 2;', '```']);
  });

  test('outgrows the longest backtick run so the code cannot close the fence', () => {
    const code = 'x\n```\nescaped\n```\ny';
    const [open, ...rest] = codeFence(code, 'ts {1,3}');
    expect(open).toBe('````ts {1,3}');
    expect(rest.at(-1)).toBe('````');
    expect(rest.slice(0, -1).join('\n')).toBe(code);
    expect(tokenizeFences(codeFence(code, 'ts').join('\n'))).toMatchObject([{ kind: 'code', run: 4, closed: true }]);
  });

  test('a longer inner run still yields one fence of exactly run + 1', () => {
    expect(codeFence('``````', '')[0]).toBe('```````');
    expect(codeFence('`', '')[0]).toBe('```');
  });
});
