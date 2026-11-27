import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, resolve } from 'path';
import { emptyLedger, writeLedger } from '../src/docgen/history.js';
import { generateDocs } from '../src/docgen/index.js';
import { CONTENT_REVISED_DATE } from '../src/page-history.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVISED = `${CONTENT_REVISED_DATE}T00:00:00.000Z`;

/** Every file under `dir`, keyed by its path relative to `dir`. */
function tree(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = join(entry.parentPath, entry.name);
      files.set(relative(dir, file), readFileSync(file));
    }
  }
  return files;
}

/** The `date` frontmatter value of a generated page, or undefined when it has none. */
function dateOf(page: string): string | undefined {
  const head = page.slice(0, page.indexOf('\n---\n', 3));
  const line = head.split('\n').find((l) => l.startsWith('date: '));
  return line ? JSON.parse(line.slice('date: '.length)) : undefined;
}

describe('repeatable docgen output', () => {
  let dir: string;
  let ledgerFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'docgen-repeat-'));
    ledgerFile = join(dir, 'ledger.json');
    const ledger = emptyLedger();
    ledger.versions.push('10.0.0', '10.4.0');
    // Changed after the site-wide revision: the change sets the page's date.
    ledger.types['constructs.Node'] = [0, 1, '2026-10-01T12:00:00.000Z', 'aaaaaaaaaaaa'];
    // Changed before it: the site-wide revision wins.
    ledger.types['constructs.Construct'] = [0, 0, '2020-01-01T00:00:00.000Z', 'bbbbbbbbbbbb'];
    // The package README, which also dates the generated API overview.
    ledger.readmes.constructs = [0, 1, '2026-10-02T00:00:00.000Z', 'cccccccccccc'];
    writeLedger(ledgerFile, ledger);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const generate = (name: string) => {
    const out = join(dir, name);
    generateDocs({ modules: ['constructs'] }, {
      outDir: join(out, 'v2'),
      overviewFile: join(out, 'v2', 'index.md'),
      agentOutDir: join(out, 'agent'),
      publicDir: join(out, 'public'),
      packageRoot: ROOT,
      ledgerFile,
      languages: ['ts'],
    });
    return out;
  };

  test('two runs from the same inputs write byte-identical files', () => {
    const first = tree(generate('first'));
    const second = tree(generate('second'));
    expect(first.size).toBeGreaterThan(10);
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
    for (const [file, bytes] of first) {
      expect({ file, same: bytes.equals(second.get(file)!) }).toEqual({ file, same: true });
    }
  });

  test('every page carries a stable Pagefind date: its content-revised instant', () => {
    const out = generate('dated');
    const page = (name: string) => readFileSync(join(out, 'v2', 'docs', name), 'utf-8');

    // A page with history changed after the site-wide revision is dated by that change.
    expect(dateOf(page('constructs.Node.md'))).toBe('2026-10-01T12:00:00.000Z');
    // A page with older history, and a page with none, are dated by the site-wide revision.
    expect(dateOf(page('constructs.Construct.md'))).toBe(REVISED);
    expect(dateOf(page('constructs.Dependable.md'))).toBe(REVISED);
    // The package README page and the generated API overview share the README's history.
    expect(dateOf(page('constructs-readme.md'))).toBe('2026-10-02T00:00:00.000Z');
    expect(dateOf(readFileSync(join(out, 'v2', 'index.md'), 'utf-8'))).toBe('2026-10-02T00:00:00.000Z');

    // Every Markdown page docgen writes has one, and `agentMarkdown` stays the first key.
    for (const [file, bytes] of tree(join(out, 'v2'))) {
      if (!file.endsWith('.md')) continue;
      const text = bytes.toString('utf-8');
      expect({ file, date: dateOf(text) !== undefined }).toEqual({ file, date: true });
      expect({ file, first: text.split('\n')[1]!.startsWith('agentMarkdown: ') }).toEqual({ file, first: true });
    }
  });

  test('the agent Markdown twins carry no date', () => {
    const out = generate('twins');
    const twins = tree(join(out, 'agent'));
    expect(twins.size).toBeGreaterThan(10);
    for (const [file, bytes] of twins) {
      expect({ file, date: /^date: /m.test(bytes.toString('utf-8')) }).toEqual({ file, date: false });
    }
  });
});
