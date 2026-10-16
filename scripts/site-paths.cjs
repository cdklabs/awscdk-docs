// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Where the built site lives, on disk and in URL space — one derivation
// shared by the VitePress config, the shard/merge scripts and the tests.
//
// The site is published as a zip served from a sub-path
// (https://docs.aws.amazon.com/cdk/api/, issue #150). The
// publishing target takes no loose files at its root, so the built tree
// MIRRORS the hosted path: `base` and `outDir` come from the same string and
// cannot drift, and the artifact root holds exactly one directory. Point the
// upload at whatever depth its own root sits at.
//
// `DOCS_BASE` unset (local builds, the e2e/a11y/Lighthouse fixture builds)
// means base `/` and the historical flat `docs/.vitepress/dist` — the
// nesting is inert there.
'use strict';

/** Dist root, before the hosted path is appended. Repo-relative, POSIX. */
const DIST_ROOT = 'docs/.vitepress/dist';

/** Dist root relative to the VitePress srcDir (`docs/`), which `outDir` resolves against. */
const SRC_RELATIVE_DIST_ROOT = '.vitepress/dist';

/** A URL path prefix: `/`, or `/`-delimited segments of unreserved URL characters, none `.` or `..`. */
const BASE_PATTERN = /^\/(?:(?!\.\.?\/)[A-Za-z0-9._~-]+\/)*$/;

/**
 * Site base path, normalized to exactly one leading and one trailing slash.
 * Mirrors siteBase() in src/docgen/links.ts, which prefixes the raw-HTML
 * hrefs docgen emits (test/hosting-base.test.ts pins the two in agreement).
 */
function siteBase(env = process.env) {
  const raw = env.DOCS_BASE ?? '/';
  let base = raw.startsWith('/') ? raw : `/${raw}`;
  if (!base.endsWith('/')) {
    base = `${base}/`;
  }
  if (!BASE_PATTERN.test(base)) {
    throw new Error(`DOCS_BASE must be a URL path prefix such as /cdk/api/, got ${JSON.stringify(raw)}`);
  }
  return base;
}

/** Append the base path to a dist root: `<root>/cdk/api`, no trailing slash. */
function withBase(root, env = process.env) {
  const base = siteBase(env);
  return base === '/' ? root : `${root}${base}`.replace(/\/+$/, '');
}

/** Built site directory, repo-relative — what serves, indexes and uploads. */
function distDir(env = process.env) {
  return withBase(DIST_ROOT, env);
}

/** The same directory as VitePress `outDir`, i.e. relative to `docs/`. */
function outDir(env = process.env) {
  return withBase(SRC_RELATIVE_DIST_ROOT, env);
}

module.exports = { DIST_ROOT, SRC_RELATIVE_DIST_ROOT, siteBase, distDir, outDir };
