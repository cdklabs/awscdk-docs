import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import type { Rollup } from 'vite';
import * as compilerSfc from 'vue/compiler-sfc';
import { astReleasingCompiler } from '../docs/.vitepress/vue-compiler.js';

// The Vite and Vue plugin copies VitePress builds with.
const fromVitepress = createRequire(createRequire(import.meta.url).resolve('vitepress'));
const { build } = await import(pathToFileURL(fromVitepress.resolve('vite')).href) as typeof import('vite');
const { default: vue } = await import(pathToFileURL(fromVitepress.resolve('@vitejs/plugin-vue')).href) as
  typeof import('@vitejs/plugin-vue');

// Shaped like a VitePress page: a plain <script> (no <script setup>), so the Vue plugin compiles the template
// itself and reuses the descriptor's AST.
const PAGE = `<template><div><h1 id="queue">Queue <a class="header-anchor" href="#queue">#</a></h1>
<p>Static prose with <code>inline code</code> and a <a href="./Bucket.html">link</a>.</p>
<ul><li v-for="item in items" :key="item">{{ item }}</li></ul>
<pre class="shiki"><code><span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583">import</span></span></code></pre>
</div></template>
<script>
export default { name: 'page', data: () => ({ items: ['a', 'b'] }) };
</script>
`;

type Compiler = typeof compilerSfc;

/** The page chunk of a client build and of an SSR build, run one after the other in one process, as VitePress does. */
async function buildPage(compiler: Compiler): Promise<{ client: string; ssr: string }> {
  const root = mkdtempSync(join(tmpdir(), 'vue-compiler-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'Page.vue'), PAGE);
    const run = async (ssr: boolean): Promise<string> => {
      const out = await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [vue({ compiler })],
        build: {
          write: false,
          minify: false,
          ssr: ssr ? 'src/Page.vue' : false,
          rollupOptions: {
            external: [/^vue(\/|$)/],
            preserveEntrySignatures: 'allow-extension',
            ...(ssr ? {} : { input: join(root, 'src', 'Page.vue') }),
          },
        },
      });
      const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
      return outputs.flatMap((o) => o.output).filter((c): c is Rollup.OutputChunk => c.type === 'chunk')
        .map((c) => c.code).join('\n').split(root).join('<root>');
    };
    const client = await run(false);
    const ssr = await run(true);
    return { client, ssr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Vue compiler that releases template ASTs', () => {
  let stock: { client: string; ssr: string };
  let releasing: { client: string; ssr: string };
  // What the Vue plugin hands the wrapped compiler on each call: the AST it passes in, and that AST once compiled.
  const calls: { compiledBefore: boolean; keysBefore: string[]; keysAfter: string[] }[] = [];

  beforeAll(async () => {
    stock = await buildPage(compilerSfc);
    const recording: Compiler = {
      ...astReleasingCompiler,
      compileTemplate(options) {
        const ast = options.ast as unknown as Record<string, unknown> | undefined;
        const compiledBefore = ast?.transformed === true;
        const keysBefore = Object.keys(ast ?? {}).sort();
        const result = astReleasingCompiler.compileTemplate(options);
        calls.push({ compiledBefore, keysBefore, keysAfter: Object.keys(ast ?? {}).sort() });
        return result;
      },
    };
    releasing = await buildPage(recording);
  }, 60_000);

  test('the client build matches the stock compiler', () => {
    expect(stock.client).toContain('Static prose with');
    expect(releasing.client).toBe(stock.client);
  });

  test('the SSR build, which compiles the cached page again, matches the stock compiler', () => {
    expect(stock.ssr).toContain('ssrRender');
    expect(stock.ssr).toContain('Static prose with');
    expect(releasing.ssr).toBe(stock.ssr);
  });

  test('the plugin hands the SSR build the released AST, and every compiled AST is released', () => {
    expect(calls).toHaveLength(2);
    expect(calls[0].compiledBefore).toBe(false);
    expect(calls[1]).toEqual({
      compiledBefore: true,
      keysBefore: ['source', 'transformed'],
      keysAfter: ['source', 'transformed'],
    });
    expect(calls[0].keysAfter).toEqual(['source', 'transformed']);
  });
});
