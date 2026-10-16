import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// ADRs are internal engineering artifacts and must not appear on the rendered site — no built /adr/ pages, so no sidebar,
// nav, or Pagefind search exposure. The markdown files stay in the repo.
describe('exclude ADRs from the rendered site', () => {
  const config = readFileSync(
    resolve(ROOT, 'docs/.vitepress/config.mts'),
    'utf-8',
  );

  test('config has no /adr/ page links (nav or sidebar)', () => {
    expect(config).not.toContain('"/adr/');
    expect(config).not.toContain('Decision Records');
  });

});
