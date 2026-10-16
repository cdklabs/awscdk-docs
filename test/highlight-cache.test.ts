import { readFileSync } from 'fs';
import { resolve } from 'path';
import { applyTypeLinks } from '../docs/.vitepress/type-links.js';

const ROOT = resolve(import.meta.dirname, '..');

// The VitePress `markdown.highlight` hook runs Shiki (dual github-light/dark
// theme, ~15 ms/fence) once per fenced code block at build time. On the
// ts+python tree ~26% of fences are EXACT duplicates (repeated imports,
// `declare const` stubs, the DynamoDB CFN `addOverride` escape-hatch pair on
// every property page), and highlighting is ~35% of a shard's build
// wall-clock — so the hook memoizes its output keyed on (language, exact
// code).
//
// These guard the invariants that keep the cache CORRECT (byte-identical to
// the uncached path). The behavioral byte-for-byte equivalence is proven by
// building the real site; here we pin the source-level contract so a later
// edit cannot silently break it.
describe('VitePress highlight cache', () => {
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
  const fn = config.slice(
    config.indexOf('async function makeHighlight()'),
    config.indexOf('async function makeHighlight()') + 3400,
  );

  test('makeHighlight memoizes with a Map', () => {
    expect(fn).toMatch(/const cache = new Map<string, string>\(\)/);
    expect(fn).toMatch(/cache\.get\(key\)/);
    expect(fn).toMatch(/cache\.set\(key, html\)/);
  });

  test('cache key is (language, EXACT code) with a NUL separator', () => {
    // Must key on `language` (the loaded-or-txt fallback), NOT the raw `lang`,
    // so two fences that both fall back to txt share a cache entry correctly.
    expect(fn).toMatch(/const key = `\$\{language\}\\u0000\$\{code\}`/);
  });

  test('code is NOT whitespace-normalized in the key', () => {
    // A trailing newline changes the emitted token text, so normalizing the
    // key (e.g. code.trim()) would serve the wrong HTML for a near-duplicate
    // fence. Assert no trim/replace is applied when building the key.
    const keyLine = fn.split('\n').find((l) => l.includes('const key =')) ?? '';
    expect(keyLine).not.toMatch(/\.trim\(\)|\.replace\(/);
  });

  test('a cache hit short-circuits before codeToHtml', () => {
    const hitIdx = fn.indexOf('if (cached !== undefined) return applyTypeLinks(cached, attrs)');
    const htmlIdx = fn.indexOf('highlighter.codeToHtml');
    expect(hitIdx).toBeGreaterThan(-1);
    expect(hitIdx).toBeLessThan(htmlIdx);
  });

});

// Inline type links in generated signature fences: docgen emits
// a `type-links=Name:href,…` fence attribute and the hook wraps the mapped
// identifiers in anchors AFTER highlighting. The contract that keeps the
// cache correct: the cache stores the PURE Shiki output and links are
// applied per call — the same signature text can resolve to different link
// targets on different pages, so a linkified cached value would poison
// duplicate-fence hits.
describe('signature fence type links', () => {
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');

  test('type links are applied on BOTH return paths, outside the cache', () => {
    // Hit path and miss path both post-process; the stored value is pure.
    expect(config).toContain('if (cached !== undefined) return applyTypeLinks(cached, attrs)');
    expect(config).toContain('return applyTypeLinks(html, attrs)');
    expect(config).toContain('cache.set(key, html)');
    expect(config).not.toContain('cache.set(key, applyTypeLinks');
  });

  // Behavioral coverage of the extracted helper — the hook runs on every
  // fence on the site, so `type-links=` values from authored README fences
  // are third-party input and both sides of each pair must be validated.
  const HTML = '<pre class="shiki"><span>new Bucket(scope: Construct)</span></pre>';

  test('links a mapped identifier to its site-relative page', () => {
    const out = applyTypeLinks(HTML, 'type-links=Construct:/v2/docs/constructs.Construct.html');
    expect(out).toContain(
      '<a class="code-type-link" href="/v2/docs/constructs.Construct.html">Construct</a>',
    );
  });

  test('identifiers are matched on boundaries and only inside text runs', () => {
    // No match inside a longer identifier, and tag contents are untouched.
    const html = '<pre class="Construct"><span>IConstruct Construct</span></pre>';
    const out = applyTypeLinks(html, 'type-links=Construct:/a.html');
    expect(out).toContain('class="Construct"'); // attribute untouched
    expect(out).toContain('IConstruct <a'); // boundary: prefix not linked
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  test('a hostile javascript: href emits NO anchor', () => {
    const out = applyTypeLinks(HTML, 'type-links=Construct:javascript:alert(document.domain)');
    expect(out).toBe(HTML);
    expect(out).not.toContain('<a');
  });

  test('an attribute-breakout href emits NO anchor', () => {
    const out = applyTypeLinks(HTML, 'type-links=Construct:/a.html"><img/src=x/onerror=alert(1)>');
    expect(out).toBe(HTML);
  });

  test('a protocol-relative href emits NO anchor', () => {
    const out = applyTypeLinks(HTML, 'type-links=Construct://evil.example/x');
    expect(out).toBe(HTML);
  });

  test('a backslash after the leading slash emits NO anchor', () => {
    const out = applyTypeLinks(HTML, 'type-links=Construct:/\\evil.example/x');
    expect(out).toBe(HTML);
  });

  test('an @-scoped alpha package href is linked', () => {
    // assemblyDocId keeps a leading `@` verbatim, so every alpha type's page
    // href contains `@`; dropping these would unlink every alpha package.
    const out = applyTypeLinks(
      HTML,
      'type-links=Construct:/v2/docs/@aws-cdk_aws-amplify-alpha.AppProps.html',
    );
    expect(out).toContain(
      '<a class="code-type-link" href="/v2/docs/@aws-cdk_aws-amplify-alpha.AppProps.html">Construct</a>',
    );
  });

  test('non-site-relative and non-identifier pairs are dropped, valid ones kept', () => {
    const out = applyTypeLinks(
      HTML,
      'type-links=Construct:https://evil.example/x,Bucket:/v2/docs/aws-cdk-lib.aws_s3.Bucket.html',
    );
    expect(out).not.toContain('evil.example');
    expect(out).toContain('<a class="code-type-link" href="/v2/docs/aws-cdk-lib.aws_s3.Bucket.html">Bucket</a>');
  });

  test('the emitted anchor carries the code-type-link class the theme styles', () => {
    const out = applyTypeLinks(HTML, 'type-links=Construct:/a.html');
    expect(out).toContain('<a class="code-type-link"');
    const css = readFileSync(resolve(ROOT, 'docs/.vitepress/theme/signatures.css'), 'utf-8');
    // The anchor inherits the Shiki token color; dotted underline is the
    // only affordance, keeping the fence identical to an example block.
    expect(css).toMatch(/\.vp-code a\.code-type-link \{[^}]*color: inherit/);
  });
});
