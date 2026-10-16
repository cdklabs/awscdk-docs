#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Minimal static file server for the browser e2e suite.
//
// `vitepress preview` brotli-encodes each response at a slow quality level, so the multi-MB client assets the
// interactive features fetch take seconds each, starving the features under test and making the suite flaky.
// This server streams files uncompressed over localhost — plenty fast for a test run.
//
// Usage: node scripts/e2e-serve.cjs [port] — serves docs/.vitepress/dist, bound to 127.0.0.1 only.
//
// E2E_SERVE_GZIP=1 opts into gzip for text assets. Off by default (the e2e suite wants raw speed); the
// Lighthouse gate turns it on because its JS+CSS budget is in gzipped bytes and Lighthouse measures transfer
// size, so serving uncompressed would compare against a compressed budget and pass oversized bundles.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.argv[2] ?? 4173);
// Root is overridable so tests can serve a small fixture instead of a real
// build; unset it resolves to the VitePress output as before. Note this is the
// dist ROOT, not the site directory: under a non-root DOCS_BASE the site sits
// at dist/<base> (#150) and the base-prefixed URLs only resolve when the tree
// root is what's served.
const ROOT = process.env.E2E_SERVE_ROOT
  ? path.resolve(process.env.E2E_SERVE_ROOT)
  : path.resolve(__dirname, '..', require('./site-paths.cjs').DIST_ROOT);
const GZIP = process.env.E2E_SERVE_GZIP === '1';

// Text types worth compressing; images/fonts/wasm are already compressed.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.md', '.xml', '.txt']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
};

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safe = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) {
    return undefined;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    return file;
  }
  return undefined;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url ?? '/') ?? path.join(ROOT, '404.html');
  const exists = fs.existsSync(file);
  const status = exists && !file.endsWith('404.html') ? 200 : 404;
  const headers = {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
  };
  const gzip = GZIP
    && exists
    && COMPRESSIBLE.has(path.extname(file))
    && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  if (gzip) {
    headers['content-encoding'] = 'gzip';
  }
  if (GZIP && exists) {
    // Production serves these with caching; without a Cache-Control header Lighthouse reports every asset as
    // uncacheable and marks down a gate meant to measure the deployed site. Hashed build assets are immutable,
    // everything else gets a short TTL. VitePress names them `<name>.<8-char hash>[.lean].{js,css}`.
    headers['cache-control'] = /\.[A-Za-z0-9_-]{8}(\.lean)?\.(js|css)$/.test(file)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=600';
  }
  res.writeHead(status, headers);
  if (!exists) {
    res.end('Not found');
    return;
  }
  const body = fs.createReadStream(file);
  if (gzip) {
    body.pipe(zlib.createGzip()).pipe(res);
  } else {
    body.pipe(res);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // Report the actual bound port: callers may pass 0 to get an unused one, which is how the Lighthouse gate
  // avoids fighting the e2e suite (and other checkouts) for a fixed port.
  const bound = server.address().port;
  // eslint-disable-next-line no-console
  console.log(
    `e2e static server: http://127.0.0.1:${bound} -> ${ROOT}${GZIP ? ' (gzip)' : ''}`,
  );
});
