import { closeDanglingFence } from '../src/docgen/index.js';

describe('closeDanglingFence', () => {
  test('leaves a balanced tilde block alone when its body holds a backtick line', () => {
    const readme = [
      '# Package',
      '',
      '~~~md',
      'A fence opener, shown literally:',
      '```',
      '~~~',
      '',
      'Trailing prose.',
    ].join('\n');
    expect(closeDanglingFence(readme)).toBe(readme);
  });

  test('does not count a fence indented far enough to be an indented code block', () => {
    const readme = [
      '# Package',
      '',
      'An indented code block, not a fence:',
      '',
      '    ```',
      '    still literal text',
      '',
      'Trailing prose.',
    ].join('\n');
    expect(closeDanglingFence(readme)).toBe(readme);
  });

  test('closes a genuinely unclosed backtick fence', () => {
    const readme = ['# Package', '', '```ts', 'const x = 1;'].join('\n');
    expect(closeDanglingFence(readme)).toBe(`${readme}\n\`\`\`\n`);
  });

  test('closes an unclosed tilde fence with a tilde, which alone can close it', () => {
    const readme = ['# Package', '', '~~~ts', 'const x = 1;'].join('\n');
    expect(closeDanglingFence(readme)).toBe(`${readme}\n~~~\n`);
  });

  test('a run carrying an info string does not close the fence', () => {
    const readme = ['```ts', 'x', '``` ts'].join('\n');
    expect(closeDanglingFence(readme)).toBe(`${readme}\n\`\`\`\n`);
  });

  test('a shorter run of the same marker inside a longer fence does not close it', () => {
    const readme = ['````', '```', 'not a closer', '````'].join('\n');
    expect(closeDanglingFence(readme)).toBe(readme);
  });

  test('a README ending in an unclosed blockquoted fence is left untouched', () => {
    // The quoted fence already ends with its blockquote; a column-0 closer
    // appended for it would be a new dangling opener.
    const md = '# Lib\n\n> Note:\n> ```js\n> quoted();';
    expect(closeDanglingFence(md)).toBe(md);
  });
});
