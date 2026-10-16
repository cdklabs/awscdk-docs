import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveLucideIcon } from '../docs/.vitepress/feature-icons.js';

const ROOT = resolve(import.meta.dirname, '..');

describe('landing page', () => {
  const indexMd = readFileSync(resolve(ROOT, 'docs/index.md'), 'utf-8');

  test('uses the VitePress home layout with a hero', () => {
    expect(indexMd).toContain('layout: home');
    expect(indexMd).toContain('hero:');
    expect(indexMd).toContain('features:');
  });

  test('primary hero action is the API Reference', () => {
    // The first (brand-themed) action must be the reference docs CTA.
    const brandBlock = indexMd.match(/- theme: brand\n\s+text: (.+)\n\s+link: (.+)/);
    expect(brandBlock).not.toBeNull();
    expect(brandBlock![1]).toBe('API Reference');
    expect(brandBlock![2]).toBe('/v2/');
  });

  test('hero offers exactly one action, not duplicating card destinations', () => {
    // Two extra `alt` actions -- Developer Guide and View on GitHub -- would
    // repeat destinations already reachable below: the guide from feature
    // card 2, and the framework repo from the
    // navbar social link (deliberate). Three routes to /api/ in
    // one viewport (nav + hero + card 1) competed with the primary path
    // instead of reinforcing it, so the hero keeps only the brand action.
    const heroSection = indexMd.slice(
      indexMd.indexOf('hero:'),
      indexMd.indexOf('features:'),
    );
    expect(heroSection.match(/- theme: /g)).toHaveLength(1);
    expect(heroSection).not.toContain('theme: alt');
  });

  test('feature cards link to all four destinations', () => {
    // 1. This site's API reference
    expect(indexMd).toContain('link: /v2/');
    // 2. CDK Developer Guide
    expect(indexMd).toContain(
      'link: https://docs.aws.amazon.com/cdk/v2/guide/home.html',
    );
    // 3. The AWS CDK agent skill (there are exactly four cards: a fifth
    //    breaks the 2x2 grid, and an examples card would overlap card 2,
    //    already the start-here route for newcomers)
    expect(indexMd).toContain('link: /skills');
    // 4. Construct Hub
    expect(indexMd).toContain('link: https://constructs.dev');
  });

  test('feature cards carry titles and blurbs', () => {
    for (const title of [
      'API Reference',
      'AWS CDK Developer Guide',
      'Agent Skills',
      'Construct Hub',
    ]) {
      expect(indexMd).toContain(`title: ${title}`);
    }
    // Every feature card has a details blurb and a linkText label.
    const featuresSection = indexMd.slice(indexMd.indexOf('features:'));
    const cards = featuresSection.match(/- icon:/g) ?? [];
    const details = featuresSection.match(/details: .+/g) ?? [];
    const linkTexts = featuresSection.match(/linkText: .+/g) ?? [];
    expect(cards.length).toBe(4);
    expect(details.length).toBe(4);
    expect(linkTexts.length).toBe(4);
  });
  describe('feature card icons, resolved at build time', () => {
    // Card title -> the lucide glyph it renders. The frontmatter carries these
    // as `lucide:<name>` tokens; docs/.vitepress/config.mts resolves each into
    // the inlined SVG string in transformPageData before VitePress renders.
    const ICONS: Record<string, string> = {
      'API Reference': 'book-open',
      'AWS CDK Developer Guide': 'compass',
      'Agent Skills': 'bot',
      'Construct Hub': 'blocks',
    };

    /** The icon token for one card, by its title. */
    function iconFor(title: string): string {
      const card = indexMd.slice(
        indexMd.lastIndexOf('- icon:', indexMd.indexOf(`title: ${title}`)),
        indexMd.indexOf(`title: ${title}`),
      );
      const token = card.match(/- icon: (lucide:[a-z0-9-]+)/);
      expect(token).not.toBeNull();
      return token![1];
    }

    /** A lucide file's shape elements, whitespace-collapsed. */
    function upstreamGeometry(name: string): string {
      const src = readFileSync(
        resolve(ROOT, `node_modules/lucide-static/icons/${name}.svg`),
        'utf-8',
      );
      const open = src.indexOf('>', src.indexOf('<svg')) + 1;
      return src.slice(open, src.lastIndexOf('</svg>')).replace(/\s+/g, ' ').trim();
    }

    test('the emoji are gone', () => {
      // Four multicolor OS-rendered glyphs clash with a monochrome brand mark,
      // and leaving any one behind keeps the clash.
      for (const emoji of ['📚', '🧭', '🧪', '🧱']) {
        expect(indexMd).not.toContain(emoji);
      }
    });

    test('the source carries tokens, not markup', () => {
      expect(indexMd).not.toContain('<svg');
    });

    test.each(Object.entries(ICONS))(
      '%s resolves the %s glyph as the package ships it',
      (title, name) => {
        expect(iconFor(title)).toBe(`lucide:${name}`);
        // The resolved markup carries the treated header and the package
        // file's own shape elements — the drift pin, applied to what the
        // resolver actually returns.
        const svg = resolveLucideIcon(`lucide:${name}`);
        expect(svg).toContain('viewBox="0 0 24 24"');
        expect(svg).toContain('fill="none"');
        expect(svg).toContain('stroke="currentColor"');
        expect(svg).toContain('stroke-width="1.5"');
        expect(svg).toContain('aria-hidden="true"');
        expect(svg).toContain(upstreamGeometry(name));
      },
    );

    test('no card renders another card\'s glyph', () => {
      const seen = Object.keys(ICONS).map(iconFor);
      expect(new Set(seen).size).toBe(4);
    });

    test('an unknown token fails the build', () => {
      expect(() => resolveLucideIcon('lucide:no-such-glyph')).toThrow(/no-such-glyph/);
    });
  });

  test('publishes the approved introduction and advertises a root Markdown twin', () => {
    expect(indexMd).toContain('agentMarkdown: "/index.md"');
    expect(indexMd).toContain('## What is the AWS CDK');
    expect(indexMd).toContain('framework for defining cloud infrastructure as code');
    expect(indexMd).toContain('## Getting started');
    expect(indexMd).toContain('[Getting Started guide]');
    expect(indexMd).toContain('[API Reference](/v2/)');
  });
});
