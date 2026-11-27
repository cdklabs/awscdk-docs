import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { Plugin, Rollup } from 'vite';
import { KEPT_OUTPUT_FIELDS, releaseBuildOutput } from '../docs/.vitepress/release-build-output.js';

// The Vite copy VitePress builds with.
const fromVitepress = createRequire(createRequire(import.meta.url).resolve('vitepress'));
const { build } = await import(pathToFileURL(fromVitepress.resolve('vite')).href) as typeof import('vite');

// What VitePress reads after the build, per output type.
const CHUNK_FIELDS = ['dynamicImports', 'facadeModuleId', 'fileName', 'imports', 'isEntry', 'moduleIds', 'name', 'type'];
const ASSET_FIELDS = ['fileName', 'name', 'type'];

type Built = { root: string; output: Rollup.RollupOutput['output']; files: Map<string, string> };

function listFiles(dir: string, root = dir, out = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(path, root, out);
    else out.set(relative(root, path), readFileSync(path, 'utf-8'));
  }
  return out;
}

/** A written build of a page-shaped entry (a static import, a dynamic import and a stylesheet), with extra plugins. */
async function buildSite(plugins: Plugin[]): Promise<Built> {
  const root = mkdtempSync(join(tmpdir(), 'release-build-output-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'shared.js'), 'export const shared = (s) => `shared ${s}`;\n');
    writeFileSync(join(root, 'src', 'lazy.js'), 'import { shared } from "./shared.js";\nexport default shared("lazy");\n');
    writeFileSync(join(root, 'src', 'style.css'), '.page { color: red; }\n');
    writeFileSync(join(root, 'src', 'page.js'), [
      'import "./style.css";',
      'import { shared } from "./shared.js";',
      'console.log(shared("page"));',
      'export const lazy = () => import("./lazy.js");',
      '',
    ].join('\n'));
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins,
      build: {
        outDir: join(root, 'dist'),
        minify: false,
        cssCodeSplit: false,
        rollupOptions: { input: { page: join(root, 'src', 'page.js') }, preserveEntrySignatures: 'allow-extension' },
      },
    }) as Rollup.RollupOutput;
    return { root, output: result.output, files: listFiles(join(root, 'dist')) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The given fields of an output file, with the build's temp root replaced so two builds compare equal. */
const pick = (built: Built, file: object, fields: string[]) => JSON.parse(
  JSON.stringify(Object.fromEntries(fields.map((key) => [key, (file as Record<string, unknown>)[key]])))
    .split(built.root).join('<root>'));

describe('releasing the build output once written', () => {
  let stock: Built;
  let released: Built;

  beforeAll(async () => {
    stock = await buildSite([]);
    released = await buildSite([releaseBuildOutput()]);
  }, 60_000);

  test('the written files are the same as without the plugin', () => {
    expect(stock.files.size).toBeGreaterThanOrEqual(3);
    expect([...stock.files.values()].join('\n')).toContain('shared');
    expect(released.files).toEqual(stock.files);
  });

  test('the kept fields are exactly the ones VitePress reads', () => {
    expect([...KEPT_OUTPUT_FIELDS].sort()).toEqual(CHUNK_FIELDS);
  });

  test('every chunk keeps only what VitePress reads, with the values of a stock build', () => {
    const chunks = released.output.filter((file) => file.type === 'chunk');
    expect(chunks.map((c) => c.fileName).sort()).toEqual(
      stock.output.filter((file) => file.type === 'chunk').map((c) => c.fileName).sort());
    for (const chunk of chunks) {
      expect(Object.keys(chunk).sort()).toEqual(CHUNK_FIELDS);
      const before = stock.output.find((file) => file.fileName === chunk.fileName)!;
      expect(pick(released, chunk, CHUNK_FIELDS)).toEqual(pick(stock, before, CHUNK_FIELDS));
    }
    expect(chunks.some((c) => c.dynamicImports.length > 0)).toBe(true);
  });

  test('code, source maps, module sources and asset sources are gone', () => {
    const stockChunk = stock.output.find((file) => file.type === 'chunk' && file.isEntry) as Rollup.OutputChunk;
    expect(stockChunk.code).toContain('shared');
    expect(Object.keys(stockChunk.modules).length).toBeGreaterThan(0);
    for (const file of released.output) {
      for (const dropped of ['code', 'map', 'modules', 'source', 'viteMetadata']) {
        expect(file).not.toHaveProperty(dropped);
      }
    }
    const asset = released.output.find((file) => file.type === 'asset')!;
    expect(asset.fileName).toMatch(/\.css$/);
    expect(Object.keys(asset).sort()).toEqual(ASSET_FIELDS);
  });

  // Config shape: the freed memory has no build output to assert, so pin that the site config registers the plugin.
  test('the VitePress config registers the plugin', () => {
    const config = readFileSync(resolve(import.meta.dirname, '..', 'docs/.vitepress/config.mts'), 'utf-8');
    expect(config).toMatch(/^\s*releaseBuildOutput\(\),$/m);
  });
});
