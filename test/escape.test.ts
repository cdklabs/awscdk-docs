import { escapeAttr, escapeHtml, escapeVueText, removeAll } from '../src/docgen/escape.js';
import { escapeCell } from '../src/docgen/layout.js';
import { signatureText } from '../src/docgen/signatures.js';

// Covers five reported HTML/attribute sanitization misses — each describe
// block exercises the exact input that slipped through.

describe('escapeHtml', () => {
  test('escapes &, <, > globally', () => {
    expect(escapeHtml('a<b>&c<d>&e')).toBe('a&lt;b&gt;&amp;c&lt;d&gt;&amp;e');
  });

  test('escapes & first so entities never double-encode', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('escapeVueText', () => {
  test('escapes HTML plus Vue interpolation braces', () => {
    expect(escapeVueText('{{ x < y && z }}')).toBe('&#123;&#123; x &lt; y &amp;&amp; z &#125;&#125;');
  });
});

describe('escapeAttr (incomplete-html-attribute-sanitization)', () => {
  test('escapes double quotes so a value cannot terminate the attribute', () => {
    expect(escapeAttr('x" onmouseover="alert(1)')).toBe('x&quot; onmouseover=&quot;alert(1)');
  });

  test('escapes single quotes for single-quoted attributes', () => {
    expect(escapeAttr("x' y")).toBe('x&#39; y');
  });

  test('still escapes text-context characters', () => {
    expect(escapeAttr('<a&b>')).toBe('&lt;a&amp;b&gt;');
  });
});

describe('removeAll (incomplete-multi-character-sanitization)', () => {
  test('removals cannot re-form the pattern: spliced script tag', () => {
    // single-pass replace would leave the re-formed '<script>'
    expect(removeAll('<scr<script>ipt>alert(1)</scr</script>ipt>', /<\/?script>/g)).toBe('alert(1)');
  });

  test('removals cannot re-form the pattern: nested HTML comments', () => {
    // single-pass replace would leave 'a<!--evil-->b'
    expect(removeAll('a<!<!-- x -->--evil-->b', /<!--[\s\S]*?-->/g)).toBe('ab');
  });

  test('plain single-pass input unchanged in behavior', () => {
    expect(removeAll('a<!-- one -->b<!-- two -->c', /<!--[\s\S]*?-->/g)).toBe('abc');
  });
});

describe('escapeCell (incomplete string escaping)', () => {
  test('escapes backslash before pipe so \\ cannot neutralize the pipe escape', () => {
    expect(escapeCell('a\\|b')).toBe('a\\\\\\|b');
  });

  test('escapes pipes globally', () => {
    expect(escapeCell('a|b|c')).toBe('a\\|b\\|c');
  });

  test('escapes ampersands and angle brackets and braces', () => {
    expect(escapeCell('Record<string, {a: 1}> & more')).toBe('Record&lt;string, &#123;a: 1&#125;&gt; &amp; more');
  });

  test('collapses whitespace and trims', () => {
    expect(escapeCell('  a \n b  ')).toBe('a b');
  });
});

describe('signatureText tag stripping (incomplete-multi-character-sanitization)', () => {
  test('strips tags to fixpoint, decoding entities afterwards', () => {
    const html = '<pre v-pre class="signature"><code><span class="sig-keyword">new</span> <span class="sig-name">Bucket</span>(<span class="sig-param">scope</span>)</code></pre>';
    expect(signatureText(html)).toBe('new Bucket(scope)');
  });

  test('stripping runs to fixpoint — no complete tag survives splicing', () => {
    const out = signatureText('<sp<span>an>x</sp</span>an>');
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).toContain('x');
  });

  test('decodes attribute entities introduced by escapeAttr', () => {
    expect(signatureText('a &quot;b&quot; &#39;c&#39; &amp;d')).toBe('a "b" \'c\' &d');
  });
});
