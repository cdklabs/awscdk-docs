import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

describe('CDK brand theme', () => {
  test('theme entry exists and extends the default theme', () => {
    const entryPath = resolve(THEME_DIR, 'index.ts');
    expect(existsSync(entryPath)).toBe(true);
    const entry = readFileSync(entryPath, 'utf-8');
    expect(entry).toContain('from "vitepress/theme-without-fonts"');
    expect(entry).toContain('extends: DefaultTheme');
    expect(entry).toContain('./custom.css');
  });

  describe('custom.css', () => {
    const css = readFileSync(resolve(THEME_DIR, 'custom.css'), 'utf-8');

    const lightBlock = css.slice(
      css.indexOf(':root {'),
      css.indexOf('.dark {'),
    );
    const darkBlock = css.slice(css.indexOf('.dark {'));

    test('defines a light-mode block and a dark-mode block', () => {
      expect(css).toMatch(/:root\s*{/);
      expect(css).toMatch(/\.dark\s*{/);
    });

    test.each([
      '--vp-c-brand-1',
      '--vp-c-brand-2',
      '--vp-c-brand-3',
      '--vp-c-brand-soft',
      // The five contrast-critical ramp steps. All must be shadowed: `:root`
      // and `.dark` match <html> at equal specificity and this file loads after
      // the default theme, so an unshadowed `:root` value wins in dark mode.
      // Dropping any one of these `.dark` lines makes prose code, the language
      // label or the kind badge unreadable there while the suite stays green.
      '--vp-c-tip-1',
      '--vp-c-tip-2',
      '--vp-code-color',
      '--vp-code-link-color',
      '--vp-code-lang-color',
    ])(
      'brand variable %s is set for both light and dark mode',
      (variable) => {
        expect(lightBlock).toContain(`${variable}:`);
        expect(darkBlock).toContain(`${variable}:`);
      },
    );

    test.each(['--vp-button-brand-bg', '--vp-button-brand-text'])(
      'button variable %s is set for both light and dark mode',
      (variable) => {
        expect(lightBlock).toContain(`${variable}:`);
        expect(darkBlock).toContain(`${variable}:`);
      },
    );

    test('uses the AWS orange brand color', () => {
      expect(css.toLowerCase()).toContain('#ff9900');
    });

    test('uses the near-black ink color', () => {
      expect(lightBlock).toContain('--vp-c-text-1: #0f141a');
    });

    test('light mode uses the link blue brand step', () => {
      expect(lightBlock).toContain('--vp-c-brand-1: #006ce0');
    });

    test('dark mode uses the light link blue with orange as brand-3', () => {
      expect(darkBlock).toContain('--vp-c-brand-1: #42b4ff');
      expect(darkBlock).toContain('--vp-c-brand-3: #ff9900');
    });

    test('light mode uses a pure white page background', () => {
      expect(lightBlock).toContain('--vp-c-bg: #ffffff');
    });

    test.each(['--vp-c-bg', '--vp-c-bg-alt', '--vp-c-bg-soft', '--vp-c-bg-elv'])(
      'surface variable %s is set for both light and dark mode',
      (variable) => {
        expect(lightBlock).toContain(`${variable}:`);
        expect(darkBlock).toContain(`${variable}:`);
      },
    );

    test('dark mode shadows every text-affecting :root override', () => {
      // :root and .dark match <html> at equal specificity; this file loads
      // after the default theme, so an unshadowed :root text color leaks
      // into dark mode.
      expect(darkBlock).toContain('--vp-c-text-1:');
    });

    describe('WCAG AA contrast', () => {
      const cssVar = (block: string, name: string): string => {
        const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
        if (!match) {
          throw new Error(`variable ${name} not found as a hex color`);
        }
        return match[1];
      };

      const luminance = (hex: string): number => {
        const channels = [1, 3, 5].map((i) => {
          const c = parseInt(hex.slice(i, i + 2), 16) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };

      const contrast = (a: string, b: string): number => {
        const [la, lb] = [luminance(a), luminance(b)];
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };

      const AA = 4.5;

      test('light mode: body text on page background', () => {
        expect(
          contrast(cssVar(lightBlock, '--vp-c-text-1'), cssVar(lightBlock, '--vp-c-bg')),
        ).toBeGreaterThanOrEqual(AA);
      });

      test.each(['--vp-c-bg', '--vp-c-bg-alt', '--vp-c-bg-soft'])(
        'light mode: body text on surface %s',
        (variable) => {
          expect(
            contrast(cssVar(lightBlock, '--vp-c-text-1'), cssVar(lightBlock, variable)),
          ).toBeGreaterThanOrEqual(AA);
        },
      );

      test.each(['--vp-c-brand-1', '--vp-c-brand-2'])(
        'light mode: link color %s on every surface',
        (variable) => {
          for (const surface of ['--vp-c-bg', '--vp-c-bg-alt', '--vp-c-bg-soft']) {
            expect(
              contrast(cssVar(lightBlock, variable), cssVar(lightBlock, surface)),
            ).toBeGreaterThanOrEqual(AA);
          }
        },
      );

      test('dark mode: body text on page background', () => {
        expect(
          contrast(cssVar(darkBlock, '--vp-c-text-1'), cssVar(darkBlock, '--vp-c-bg')),
        ).toBeGreaterThanOrEqual(AA);
      });

      test.each(['--vp-c-bg', '--vp-c-bg-alt', '--vp-c-bg-soft'])(
        'dark mode: body text on surface %s',
        (variable) => {
          expect(
            contrast(cssVar(darkBlock, '--vp-c-text-1'), cssVar(darkBlock, variable)),
          ).toBeGreaterThanOrEqual(AA);
        },
      );

      test.each(['--vp-c-brand-1', '--vp-c-brand-2'])(
        'dark mode: link color %s on page background',
        (variable) => {
          expect(
            contrast(cssVar(darkBlock, variable), cssVar(darkBlock, '--vp-c-bg')),
          ).toBeGreaterThanOrEqual(AA);
        },
      );

      test.each([
        ['--vp-button-brand-text', '--vp-button-brand-bg'],
        ['--vp-button-brand-hover-text', '--vp-button-brand-hover-bg'],
        ['--vp-button-brand-active-text', '--vp-button-brand-active-bg'],
      ])('light mode: button %s on %s', (text, bg) => {
        expect(contrast(cssVar(lightBlock, text), cssVar(lightBlock, bg))).toBeGreaterThanOrEqual(AA);
      });

      test.each([
        ['--vp-button-brand-text', '--vp-button-brand-bg'],
        ['--vp-button-brand-hover-text', '--vp-button-brand-hover-bg'],
        ['--vp-button-brand-active-text', '--vp-button-brand-active-bg'],
      ])('dark mode: button %s on %s', (text, bg) => {
        expect(contrast(cssVar(darkBlock, text), cssVar(darkBlock, bg))).toBeGreaterThanOrEqual(AA);
      });

      // The hero wordmark is large text painted only by this gradient, so WCAG's 3:1 large-text
      // minimum applies to every stop.
      test.each([
        ['light', () => lightBlock],
        ['dark', () => darkBlock],
      ])('%s mode: every hero wordmark gradient stop clears 3:1 on the page', (_mode, block) => {
        const gradient = block().match(/--vp-home-hero-name-background:\s*([^;]+);/);
        expect(gradient).not.toBeNull();
        const stops = gradient![1].match(/#[0-9a-fA-F]{6}/g) ?? [];
        expect(stops.length).toBeGreaterThanOrEqual(2);
        for (const stop of stops) {
          expect(contrast(stop, cssVar(block(), '--vp-c-bg'))).toBeGreaterThanOrEqual(3);
        }
      });
    });

    test('only overrides VitePress theme variables (no element selectors)', () => {
      const selectorLines = css
        .split('\n')
        .filter((line) => line.trimEnd().endsWith('{'))
        .map((line) => line.trim());
      expect(selectorLines).toEqual([':root {', '.dark {']);
    });
  });

  describe('feature card glyph tint', () => {
    // custom.css is variables only -- the invariant below enforces that --
    // so element rules live in their own feature stylesheet, as the other
    // ten in this directory do.
    const rule = readFileSync(resolve(THEME_DIR, 'home-features.css'), 'utf-8');

    test('is imported by the theme entry', () => {
      const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
      expect(entry).toContain('./home-features.css');
    });

    test('tints the glyphs through the brand variable', () => {
      expect(rule).toContain('color: var(--vp-c-brand-1)');
    });

    test('paints with color, not stroke', () => {
      // The inlined SVGs use stroke="currentColor", so `stroke:` here would
      // override that and freeze the glyph at one color.
      expect(rule).not.toMatch(/\bstroke:/);
    });

    test('carries no literal brand hex', () => {
      // --vp-c-brand-1 already differs per palette; a literal would be
      // wrong in one of the two.
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    test('sizes the glyph', () => {
      expect(rule).toContain('width: 24px');
      expect(rule).toContain('height: 24px');
    });
  });

  test('config does not disable the appearance (light/dark) toggle', () => {
    const config = readFileSync(
      resolve(ROOT, 'docs/.vitepress/config.mts'),
      'utf-8',
    );
    expect(config).not.toMatch(/appearance:\s*false/);
  });
});

describe('AWS logo and AWS copyright', () => {
  const config = readFileSync(
    resolve(ROOT, 'docs/.vitepress/config.mts'),
    'utf-8',
  );

  test('themeConfig.logo is one decorative image beside one accessible title', () => {
    expect(config).toMatch(/logo:\s*{/);
    expect(config).toContain('src: "/aws-logo-gray.svg"');
    expect(config).toContain('alt: ""');
    expect(config).toContain('siteTitle: false');
    // A pair would render two <img> elements and fetch both on every cold load; see the ADR.
    expect(config).not.toMatch(/logo:\s*{[^}]*\b(light|dark):/);
  });

  test('dark mode turns the single logo img white without masking or hiding it', () => {
    // Both filter steps are load-bearing: brightness(0) flattens the mark to black, invert(1) makes it white.
    // Inverting #161d26 directly would give a pale tan, not white.
    const css = readFileSync(resolve(THEME_DIR, 'nav-controls.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\.dark \.VPNavBarTitle \.logo\s*{([^}]*)}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/filter:\s*brightness\(0\)\s+invert\(1\)/);
    const lightLogoRules = css.replace(/\.dark \.VPNavBarTitle \.logo\s*{[^}]*}/g, '');
    expect(lightLogoRules).not.toMatch(/\.logo[^{]*{[^}]*(filter|mask|display:\s*none|visibility:\s*hidden)/);
  });

  test('footer carries the AWS copyright wording with a computed year', () => {
    // The copyright lives in the site-wide SiteFooter.vue rather than
    // themeConfig.footer, so it also renders on /api/** pages.
    const footer = readFileSync(
      resolve(THEME_DIR, 'SiteFooter.vue'),
      'utf-8',
    );
    expect(footer).toContain('new Date().getFullYear()');
    expect(footer.replace(/\s+/g, ' ')).toContain(
      '© {{ year }}, Amazon Web Services, Inc. or its affiliates. All rights reserved.',
    );
  });
});

// API kind badge palette. These hexes are this project's own,
// not VitePress ramps, so nothing else guards their contrast: the a11y e2e
// audit runs the default color scheme only, which would let a dark-mode
// regression ship green. Both schemes are pinned here by hex.
describe('API kind badge palette', () => {
  const css = readFileSync(resolve(THEME_DIR, 'api-layout.css'), 'utf-8');

  // The union of every DECLARATION BLOCK whose selector list mentions the
  // selector, comments stripped first. Matching the raw text instead is how
  // assertions in this repo have proved nothing before: a selector named in a
  // neighboring COMMENT satisfied the match, and this file deliberately keeps
  // such a comment (`.vp-doc h1 a.header-tag`, recording where the re-homed
  // rule came from).
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleBody = (selector: string): string => {
    const bodies: string[] = [];
    const re = /([^{}]+)\{([^}]*)\}/g;
    for (let m = re.exec(bare); m !== null; m = re.exec(bare)) {
      if (m[1].includes(selector)) {
        bodies.push(m[2]);
      }
    }
    expect(bodies.length).toBeGreaterThan(0);
    return bodies.join('\n');
  };

  // The body of the one rule whose selector list is exactly `selectors`, so a
  // declaration cannot be alibied by a longer selector that merely contains it.
  const exactRuleBody = (...selectors: string[]): string => {
    const want = selectors.join(',');
    const bodies: string[] = [];
    const re = /([^{}]+)\{([^}]*)\}/g;
    for (let m = re.exec(bare); m !== null; m = re.exec(bare)) {
      if (m[1].split(',').map((s) => s.trim()).join(',') === want) {
        bodies.push(m[2]);
      }
    }
    expect(bodies).toHaveLength(1);
    return bodies[0];
  };

  // The palette declares its own `:root` / `.dark` pair, which is the
  // SECOND such pair in this stylesheet — slice from the palette block
  // rather than from the first `:root {` in the file.
  const paletteStart = css.indexOf('--cdk-badge-l1-bg');
  const darkStart = css.indexOf('.dark {', paletteStart);
  const lightBlock = css.slice(paletteStart, darkStart);
  const darkBlock = css.slice(darkStart);

  const KINDS = ['l1', 'l2', 'l3', 'mixin', 'facade', 'struct', 'interface', 'enum'] as const;

  const cssVar = (block: string, name: string): string => {
    const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) {
      throw new Error(`variable ${name} not found as a hex color`);
    }
    return match[1];
  };

  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };

  const contrast = (a: string, b: string): number => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const AA = 4.5;

  test.each(KINDS)('light mode: %s badge text on its own background clears AA', (kind) => {
    expect(
      contrast(cssVar(lightBlock, `--cdk-badge-${kind}-text`), cssVar(lightBlock, `--cdk-badge-${kind}-bg`)),
    ).toBeGreaterThanOrEqual(AA);
  });

  test.each(KINDS)('dark mode: %s badge text on its own background clears AA', (kind) => {
    expect(
      contrast(cssVar(darkBlock, `--cdk-badge-${kind}-text`), cssVar(darkBlock, `--cdk-badge-${kind}-bg`)),
    ).toBeGreaterThanOrEqual(AA);
  });

  test.each(KINDS)('%s is shadowed in dark mode', (kind) => {
    // An unshadowed `:root` color wins in dark mode, the same trap the brand
    // ramp carries. Without this, a dark-mode badge would be near-black text
    // on a pale tint while the suite stayed green.
    for (const part of ['bg', 'text']) {
      expect(darkBlock).toContain(`--cdk-badge-${kind}-${part}:`);
    }
  });

  test('the Struct, Enum and L1 light inks are pinned by hex', () => {
    // A chip label is page text, so it owes 7:1 on its own fill. With these
    // inks the only light pairs under 7:1 are L3 and Facade, which clear AA.
    // A retune that loosens one of the three has to fail here, not in an audit.
    expect(cssVar(lightBlock, '--cdk-badge-struct-text')).toBe('#831843');
    expect(cssVar(lightBlock, '--cdk-badge-enum-text')).toBe('#7c2d12');
    expect(cssVar(lightBlock, '--cdk-badge-l1-text')).toBe('#713f12');
  });

  test.each(['struct', 'enum', 'l1'] as const)('light mode: the %s ink clears 7:1 on its own fill', (kind) => {
    expect(
      contrast(cssVar(lightBlock, `--cdk-badge-${kind}-text`), cssVar(lightBlock, `--cdk-badge-${kind}-bg`)),
    ).toBeGreaterThanOrEqual(7);
  });

  test.each(KINDS)('the %s kind chip takes the fill and ink but not the border tint', (kind) => {
    // The chip's edge is `currentColor`, so it is the ink, whose contrast
    // against this fill the pair above already pins.
    const chip = exactRuleBody(`.type-chip-kind.api-badge-${kind}`);
    expect(chip).toContain(`background-color: var(--cdk-badge-${kind}-bg)`);
    expect(chip).toContain(`color: var(--cdk-badge-${kind}-text)`);
    expect(chip).not.toContain('border-color');
    expect(exactRuleBody('.type-chip-kind')).toContain('border-color: currentColor');
  });

  test('every kind has a distinct color in both schemes', () => {
    // The whole point of the issue: L1/L2/L3 were one amber and
    // Struct/Class one gray. A pair that collides again fails here.
    for (const block of [lightBlock, darkBlock]) {
      const seen = KINDS.map((kind) => cssVar(block, `--cdk-badge-${kind}-text`));
      expect(new Set(seen).size).toBe(KINDS.length);
      const backgrounds = KINDS.map((kind) => cssVar(block, `--cdk-badge-${kind}-bg`));
      expect(new Set(backgrounds).size).toBe(KINDS.length);
    }
  });

  describe('the level hues carry to the sidebar tag', () => {
    // The sidebar tag borrows only the level's FOREGROUND and keeps its
    // neutral chip, so these hues meet a surface they were not drawn
    // against — the triples above are paired with their own badge
    // backgrounds. That surface is the tag's own translucent chip
    // composited over the sidebar, not the sidebar alone: the chip keeps
    // `background-color: var(--vp-c-default-soft)`, which resolves to
    // VitePress's `--vp-c-gray-soft` and pulls the background away from the
    // text. Reading the sidebar color by itself flatters every pair by
    // roughly 11% light and 15% dark, so the alpha is read from VitePress's
    // own token and composited here — a retune upstream moves this
    // assertion with it. The tag is `aria-hidden`, which makes it the only
    // sighted channel for the level and owes the full 4.5:1.
    const themeCss = readFileSync(resolve(THEME_DIR, 'custom.css'), 'utf-8');
    const themeLight = themeCss.slice(themeCss.indexOf(':root {'), themeCss.indexOf('.dark {'));
    const themeDark = themeCss.slice(themeCss.indexOf('.dark {'));
    const LEVELS = ['l1', 'l2', 'l3'] as const;

    // VitePress declares --vp-c-gray-soft once per scheme, `:root` first.
    // Pinning the count means a restructure upstream fails loudly here
    // instead of silently measuring the wrong scheme.
    const vpVars = readFileSync(
      resolve(ROOT, 'node_modules/vitepress/dist/client/theme-default/styles/vars.css'),
      'utf-8',
    );
    const softs = [...vpVars.matchAll(/--vp-c-gray-soft:\s*rgba\(([^)]+)\)/g)].map((m) =>
      m[1].split(',').map((part) => parseFloat(part.trim())),
    );
    expect(softs).toHaveLength(2);

    /** Flatten `soft` (r,g,b,a) over an opaque hex, per channel. */
    const composite = (soft: number[], overHex: string): string => {
      const [r, g, b, a] = soft;
      const channels = [r, g, b].map((layer, i) => {
        const base = parseInt(overHex.slice(1 + i * 2, 3 + i * 2), 16);
        return Math.round(a * layer + (1 - a) * base);
      });
      return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    };

    const surfaces = {
      light: composite(softs[0], cssVar(themeLight, '--vp-c-bg-alt')),
      dark: composite(softs[1], cssVar(themeDark, '--vp-c-bg-alt')),
    };

    test.each(LEVELS)('light mode: %s tag hue on the sidebar surface clears AA', (level) => {
      expect(contrast(cssVar(lightBlock, `--cdk-badge-${level}-text`), surfaces.light)).toBeGreaterThanOrEqual(AA);
    });

    test.each(LEVELS)('dark mode: %s tag hue on the sidebar surface clears AA', (level) => {
      expect(contrast(cssVar(darkBlock, `--cdk-badge-${level}-text`), surfaces.dark)).toBeGreaterThanOrEqual(AA);
    });

    test('the chip the hues are measured against is the one that ships', () => {
      // The composited denominator above is only honest while the chip
      // really carries this token; if it ever goes opaque or changes layer,
      // the measurement silently stops describing the shipped tag.
      const sidebar = readFileSync(resolve(THEME_DIR, 'api-sidebar.css'), 'utf-8');
      const base = sidebar.indexOf('.api-sidebar-level {');
      const baseBlock = sidebar.slice(base, sidebar.indexOf('}', base));
      expect(baseBlock).toContain('background-color: var(--vp-c-default-soft)');
    });

    test('the tag keeps its neutral chip', () => {
      // The level may tint the text, never the chip: recoloring the chip
      // would make the tag as loud as the page's kind chip, which the
      // sidebar-tag ADR decided against.
      const sidebar = readFileSync(resolve(THEME_DIR, 'api-sidebar.css'), 'utf-8');
      for (const level of ['L1', 'L2', 'L3']) {
        const start = sidebar.indexOf(`.api-sidebar-level[data-level='${level}']`);
        expect(start).toBeGreaterThan(-1);
        const block = sidebar.slice(start, sidebar.indexOf('}', start));
        expect(block).toContain(`color: var(--cdk-badge-${level.toLowerCase()}-text)`);
        expect(block).not.toContain('background-color');
      }
      const base = sidebar.indexOf('.api-sidebar-level {');
      const baseBlock = sidebar.slice(base, sidebar.indexOf('}', base));
      expect(baseBlock).toContain('background-color: var(--vp-c-default-soft)');
    });

    test('the active row outranks the level, by cascade and not by luck', () => {
      // The level rules are the one new way this could invert: a tag that
      // keeps its level hue on the active row loses the row-state signal.
      // Asserting only that the `.active` rule EXISTS proves nothing — it
      // predates this change and would survive the inversion. So pin the two
      // things that actually decide it: the `.active` selector outweighs
      // every level selector, and nothing reaches for `!important` to settle
      // it. Both selectors are read back OUT of the stylesheet rather than
      // restated here, so adding a qualifier to a level rule fails this.
      // The rendered outcome is asserted in
      // `test/e2e/construct-level-consistency.spec.ts`.
      const sidebar = readFileSync(resolve(THEME_DIR, 'api-sidebar.css'), 'utf-8');
      const activeSelector = '.api-sidebar-link.active .api-sidebar-level';
      const activeAt = sidebar.indexOf(`${activeSelector} {`);
      expect(activeAt).toBeGreaterThan(-1);

      // A class and an attribute qualifier weigh the same, so count both:
      // counting dots alone reads a level selector as 1 rather than 2 and
      // would keep passing after a second qualifier pushed it past `.active`.
      const weightOf = (selector: string): number => (selector.match(/\.|\[/g) ?? []).length;
      const activeWeight = weightOf(activeSelector);

      const levelRules = [...sidebar.matchAll(/^([^\n{]*\.api-sidebar-level\[[^\n{]*?)\s*\{/gm)];
      expect(levelRules).toHaveLength(3);
      for (const [, selector] of levelRules) {
        expect(activeWeight).toBeGreaterThan(weightOf(selector));
      }

      for (const level of ['L1', 'L2', 'L3']) {
        const start = sidebar.indexOf(`.api-sidebar-level[data-level='${level}']`);
        const block = sidebar.slice(start, sidebar.indexOf('}', start));
        expect(block).not.toContain('!important');
      }
      const activeBlock = sidebar.slice(activeAt, sidebar.indexOf('}', activeAt));
      expect(activeBlock).not.toContain('!important');
    });
  });

  test('the kind badge keeps its own alignment override in the H1 line box', () => {
    // VitePress top-aligns `.vp-doc h1 > .VPBadge` and nudges it with a
    // translate. The override is needed even with the badge alone in the H1,
    // because stock alignment lifts it off the baseline it sits on. All three
    // declarations, since dropping any one hands that property back.
    const rule = css.slice(css.indexOf('.vp-doc h1 > .VPBadge.api-badge'));
    expect(rule).toContain('vertical-align: middle');
    expect(rule).toContain('margin-top: 0');
    expect(rule).toContain('transform: none');
  });

  test('the H1 carries no source-chip rules, so none linger as dead CSS', () => {
    // No source chip is emitted in the title row, so its rules must not
    // linger as dead CSS on a class nothing uses.
    expect(css).not.toMatch(/^\.header-tag\s*\{/m);
    expect(css).not.toMatch(/\.vp-doc h1 a\.header-tag\s*\{/);
  });

  test('the metadata source link is underlined at rest and the generated marker is not', () => {
    // The affordance lives on the metadata block rather than in the H1, and
    // uses brand-2 rather than brand-1 because the block sits on
    // `--vp-c-bg-soft`, where brand-1 clears AA by a thin margin.
    // Collect every rule body whose selector mentions the link, so a color
    // deleted from one rule cannot be alibied by a mention in another.
    const linkRule = ruleBody('.type-metadata-value a');
    expect(linkRule).toContain('text-decoration: underline');
    expect(linkRule).toContain('var(--vp-c-brand-2)');
    expect(linkRule).not.toContain('var(--vp-c-brand-1)');
    // `Generated at build time` is not a link and stays gray and undecorated -- that
    // difference is the point of rendering it as a span.
    const generated = ruleBody('.type-metadata-generated');
    expect(generated).toContain('var(--vp-c-text-2)');
    expect(generated).not.toContain('text-decoration: underline');
  });

  describe('type page header', () => {
    // The header's own tokens. Secondary text owes 7:1 against the page it sits
    // on, a chip label 7:1 against its own fill, and a non-text graphic such as
    // the chevron 3:1 against the page. Both schemes are pinned by hex, because
    // the a11y audit runs the default color scheme only.
    const headerStart = css.indexOf('--th-text-2');
    const headerDarkStart = css.indexOf('.dark {', headerStart);
    const headerLight = css.slice(headerStart, headerDarkStart);
    const headerDark = css.slice(headerDarkStart, css.indexOf('}', headerDarkStart));
    const PAGE_BG = { light: '#ffffff', dark: '#161d26' } as const;

    test.each(['--th-text-2', '--th-chevron'] as const)(
      '%s is shadowed in dark mode, so the light value cannot win there',
      (name) => {
        expect(headerDark).toContain(`${name}:`);
      },
    );

    test('the breadcrumb current segment clears 7:1 on the page', () => {
      for (const [scheme, block] of [['light', headerLight], ['dark', headerDark]] as const) {
        expect(contrast(cssVar(block, '--th-text-2'), PAGE_BG[scheme])).toBeGreaterThanOrEqual(7);
      }
    });

    test('the chevron clears the 3:1 graphics floor', () => {
      // A non-text graphic (WCAG 1.4.11): it carries no word.
      for (const [scheme, block] of [['light', headerLight], ['dark', headerDark]] as const) {
        expect(contrast(cssVar(block, '--th-chevron'), PAGE_BG[scheme])).toBeGreaterThanOrEqual(3);
      }
    });

    test('the neutral chip label clears 7:1 on its own fill in both schemes', () => {
      // A plain class and a level-less construct take this chip, and its label
      // is 13px bold text, so it owes what any other chip label owes. The fill
      // is an opaque token for exactly this reason: a translucent one would
      // have to be composited before it could be read.
      for (const block of [headerLight, headerDark]) {
        expect(contrast(cssVar(block, '--th-chip-neutral-text'), cssVar(block, '--th-chip-neutral-bg')))
          .toBeGreaterThanOrEqual(7);
      }
      expect(headerDark).toContain('--th-chip-neutral-bg:');
      expect(headerDark).toContain('--th-chip-neutral-text:');
      expect(exactRuleBody(".type-chip-kind:not([class*='api-badge-'])"))
        .toContain('background-color: var(--th-chip-neutral-bg)');
    });

    test('each stability chip ink clears 7:1 on its own fill in both schemes', () => {
      for (const block of [headerLight, headerDark]) {
        for (const kind of ['stable', 'exp', 'dep']) {
          expect(contrast(cssVar(block, `--th-${kind}-text`), cssVar(block, `--th-${kind}-bg`)))
            .toBeGreaterThanOrEqual(7);
        }
      }
    });

    test('a link in the deprecation note clears 4.5:1 on the note fill', () => {
      // A reason can carry a web link, which `escapeSummaryHtml` renders as an
      // anchor. `--vp-c-brand-1` on this tint is under what body text owes, so
      // the note re-points its links to brand-2 as the callouts do.
      const themeCss = readFileSync(resolve(THEME_DIR, 'custom.css'), 'utf-8');
      const themeLight = themeCss.slice(themeCss.indexOf(':root {'), themeCss.indexOf('.dark {'));
      const themeDark = themeCss.slice(themeCss.indexOf('.dark {'));
      expect(ruleBody('.vp-doc .type-deprecated-note a')).toContain('var(--vp-c-brand-2)');
      for (const [header, theme] of [[headerLight, themeLight], [headerDark, themeDark]] as const) {
        expect(contrast(cssVar(theme, '--vp-c-brand-2'), cssVar(header, '--th-dep-bg')))
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    test('the deprecation edge clears 4.5:1 on the note it bounds', () => {
      for (const block of [headerLight, headerDark]) {
        expect(contrast(cssVar(block, '--th-dep-edge'), cssVar(block, '--th-dep-bg')))
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    test('the breadcrumb is plain text in the body typeface, with no box of its own', () => {
      const bar = exactRuleBody('.type-breadcrumb');
      expect(bar).toContain('font-family: var(--vp-font-family-base)');
      expect(bar).toContain('font-size: 14px');
      expect(bar).toContain('padding: 0');
      expect(bar).not.toContain('border-radius');
      expect(bar).not.toContain('background-color');
    });

    test('the join dots are real text at no size, so a copy still gives the FQN', () => {
      // `display: none` would drop them from the selection, which is the whole
      // reason the separator a reader sees is drawn rather than written. Only
      // the joins collapse: a dot inside one segment's label is part of a
      // nested type's name and has to stay visible.
      expect(exactRuleBody('.breadcrumb-dot')).toContain('font-size: 0');
      expect(bare).not.toMatch(/\.breadcrumb-trail\s*\{[^}]*font-size:\s*0/);
      const chevron = exactRuleBody(
        '.type-breadcrumb a::after',
        '.breadcrumb-segment::after',
        '.breadcrumb-ellipsis::after',
      );
      expect(chevron).toContain("content: ''");
      expect(chevron).toContain('transform: rotate(45deg)');
      expect(chevron).toContain('var(--th-chevron)');
      // Nothing follows the current page, so the trail's last segment gets none.
      expect(exactRuleBody('.breadcrumb-trail > :last-child::after')).toContain('content: none');
    });

    test('the title treatment is keyed on the header block, so it reaches type pages only', () => {
      // This stylesheet is imported globally, so an unscoped `.vp-doc h1`
      // would restyle module overviews and authored pages as well.
      const h1 = exactRuleBody('.vp-doc h1:has(+ .type-header)');
      expect(h1).toContain('font-size: 42px');
      expect(h1).toContain('font-weight: 700');
      expect(h1).toContain('margin: 0');
      expect(bare).not.toMatch(/(^|\})\s*\.vp-doc h1\s*\{/);
    });

    test('the badge alignment override holds the Added in badge on the title baseline', () => {
      // It is the one badge an API H1 still carries. All three declarations,
      // since dropping any one hands that property back to VitePress.
      const rule = exactRuleBody('.vp-doc h1 > .VPBadge.api-badge');
      expect(rule).toContain('vertical-align: middle');
      expect(rule).toContain('margin-top: 0');
      expect(rule).toContain('transform: none');
    });

    test('the header block closes with a divider above the summary', () => {
      const block = exactRuleBody('.type-header');
      expect(block).toContain('border-bottom: 1px solid var(--vp-c-divider)');
      expect(block).toContain('padding-bottom: 16px');
      expect(block).toContain('margin: 20px 0 32px');
    });

    test('both chips share one geometry and the row wraps rather than scrolls', () => {
      const chip = exactRuleBody('.type-chip');
      expect(chip).toContain('height: 24px');
      expect(chip).toContain('border-radius: 12px');
      expect(chip).toContain('white-space: nowrap');
      const row = exactRuleBody('.type-header-row');
      expect(row).toContain('flex-wrap: wrap');
      expect(row).toContain('gap: 8px');
    });

    test('the actions box reserves the pills height, so the row does not grow on mount', () => {
      // Docgen emits the box empty; the buttons teleport in after hydration.
      expect(exactRuleBody('.type-actions')).toContain('min-height: 32px');
    });

    test('the page actions are outlined pills with a visible focus ring', () => {
      const pills = ruleBody('.vp-doc .type-actions .copy-markdown-main');
      expect(pills).toContain('border: 2px solid var(--vp-c-brand-1)');
      expect(pills).toContain('height: 32px');
      const star = ruleBody('.vp-doc .type-actions .favorite-star-button');
      expect(star).toContain('border-radius: 20px');
      // One ring treatment for every new control, the site's own.
      const ring = ruleBody(':focus-visible');
      expect(ring).toContain('outline: 2px solid var(--vp-c-brand-1)');
      for (const selector of [
        '.vp-doc .type-actions .copy-markdown-main:focus-visible',
        '.vp-doc .type-actions .favorite-star-button:focus-visible',
        '.type-breadcrumb a:focus-visible',
        '.vp-doc a.type-chip-stability:focus-visible',
      ]) {
        expect(bare).toContain(selector);
      }
    });

    test('the experimental chip keeps its chip ink against the prose link color', () => {
      // `.vp-doc a` would otherwise paint it as a link. The resting selector
      // carries `.vp-doc` too, which beats it; the hover selector adds the
      // pseudo-class, because VitePress's `.vp-doc a:hover` has the same
      // specificity as the resting rule and would otherwise win on load order.
      // The ink itself is measured in the browser, hover included, in
      // `test/e2e/type-page-header.spec.ts`.
      expect(bare).toContain('.vp-doc a.type-chip-experimental');
      expect(bare).toContain('.vp-doc a.type-chip-experimental:hover');
      expect(ruleBody('.vp-doc a.type-chip-stability')).toContain('text-decoration: underline');
    });

    test('a deprecated title is struck in the deprecation tone', () => {
      const title = exactRuleBody('.vp-doc h1 .type-title-deprecated');
      expect(title).toContain('line-through');
      expect(title).toContain('var(--th-dep-edge)');
    });

    test('the deprecation note is a left-edged block carrying the reason', () => {
      const note = exactRuleBody('.type-deprecated-note');
      expect(note).toContain('border-left: 4px solid var(--th-dep-edge)');
      expect(note).toContain('background-color: var(--th-dep-bg)');
      expect(exactRuleBody('.type-deprecated-label')).toContain('var(--th-dep-text)');
    });
  });

  test('the metadata table uses the body typeface', () => {
    const table = ruleBody('.type-metadata');
    expect(table).toContain('font-family: var(--vp-font-family-base)');
    expect(table).not.toContain('font-family: var(--vp-font-family-mono)');

    const cells = exactRuleBody('.vp-doc .type-metadata-label', '.vp-doc .type-metadata-value');
    expect(cells).toContain('font-size: inherit');
    expect(cells).toContain('vertical-align: baseline');

    const labels = ruleBody('.vp-doc .type-metadata-label');
    expect(labels).toContain('font-weight: 500');

    const rows = ruleBody('.vp-doc .type-metadata tr');
    expect(rows).toContain('background-color: transparent');
    expect(rows).toContain('border: 0');

    const values = ruleBody('.vp-doc .type-metadata-value code');
    expect(values).toContain('font-family: inherit');
  });

});

// The checked segment tints its abbreviation box with the brand soft layer over
// the elevated surface, so neither the page background nor an opaque swatch is
// the measurement. The accessibility gate audits the default scheme only.
describe('language abbreviation contrast', () => {
  const themeCss = readFileSync(resolve(THEME_DIR, 'custom.css'), 'utf-8');
  const toggle = readFileSync(resolve(THEME_DIR, 'LanguageToggle.vue'), 'utf-8');
  const lightBlock = themeCss.slice(themeCss.indexOf(':root {'), themeCss.indexOf('.dark {'));
  const darkBlock = themeCss.slice(themeCss.indexOf('.dark {'));

  const hex = (block: string, name: string): string => {
    const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) {
      throw new Error(`variable ${name} not found as a hex color`);
    }
    return match[1];
  };

  const rgba = (block: string, name: string): number[] => {
    const match = block.match(new RegExp(`${name}:\\s*rgba\\(([^)]+)\\)`));
    if (!match) {
      throw new Error(`variable ${name} not found as an rgba color`);
    }
    return match[1].split(',').map((part) => parseFloat(part.trim()));
  };

  const composite = (soft: number[], overHex: string): string => {
    const [r, g, b, a] = soft;
    const channels = [r, g, b].map((layer, i) => {
      const base = parseInt(overHex.slice(1 + i * 2, 3 + i * 2), 16);
      return Math.round(a * layer + (1 - a) * base);
    });
    return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  };

  const luminance = (value: string): number => {
    const channels = [1, 3, 5].map((i) => {
      const c = parseInt(value.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };

  const contrast = (a: string, b: string): number => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const AA = 4.5;

  const surface = (block: string): string =>
    composite(rgba(block, '--vp-c-brand-soft'), hex(block, '--vp-c-bg-elv'));

  test('light mode: the checked abbreviation clears AA on its tinted box', () => {
    expect(contrast(hex(lightBlock, '--vp-c-brand-2'), surface(lightBlock))).toBeGreaterThanOrEqual(AA);
  });

  test('dark mode: the checked abbreviation clears AA on its tinted box', () => {
    expect(contrast(hex(darkBlock, '--vp-c-brand-2'), surface(darkBlock))).toBeGreaterThanOrEqual(AA);
  });

  test('the unused brand step is under AA on that tinted box', () => {
    expect(contrast(hex(lightBlock, '--vp-c-brand-1'), surface(lightBlock))).toBeLessThan(AA);
  });

  test('the checked abbreviation is colored by the pinned step on the pinned surface', () => {
    // Holds the measurement to the tokens the rules actually carry.
    const rule = (selector: string): string => {
      const start = toggle.indexOf(selector);
      expect(start).toBeGreaterThan(-1);
      return toggle.slice(start, toggle.indexOf('}', start));
    };
    expect(rule('.language-option.active .language-abbr {')).toContain('color: var(--vp-c-brand-2)');
    expect(rule('.language-option.active .language-abbr {')).toContain(
      'background-color: var(--vp-c-brand-soft)',
    );
    expect(rule('.language-option.active {')).toContain('background-color: var(--vp-c-bg-elv)');
  });
});
