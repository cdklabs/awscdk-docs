import { readFileSync } from 'fs';
import { join } from 'path';

const tasks = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.projen', 'tasks.json'), 'utf-8')).tasks;

function ncuFilter(task: string): string[] {
  const step = tasks[task].steps.find((s: { execArgs?: string[] }) => s.execArgs?.includes('--upgrade'));
  const arg: string = step.execArgs.find((a: string) => a.startsWith('--filter='));
  return arg.slice('--filter='.length).split(',');
}

describe('scheduled upgrade filters', () => {
  test.each([
    ['upgrade', 'lucide-static'],
    ['upgrade-dev-deps', 'htmlparser2'],
    ['upgrade-dev-deps', '@jest/globals'],
    ['upgrade-dev-deps', 'lighthouse'],
    ['upgrade-dev-deps', 'botvisibility'],
  ])('%s raises the %s range', (task, pkg) => {
    expect(ncuFilter(task)).toContain(pkg);
  });

  test('upgrade leaves the peer-held markdown-it-mathjax3 range alone', () => {
    expect(ncuFilter('upgrade')).not.toContain('markdown-it-mathjax3');
  });
});
