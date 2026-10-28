import * as fs from 'fs';
import * as path from 'path';
import { API_ROOT } from '../src/site-routes.js';
import { FAILING_IMPACTS, REPRESENTATIVE_PAGES } from './e2e/fixture.js';

// Guards the accessibility gate's CONFIGURATION — not the site.
// Nothing here runs axe; that is the browser gate's job. These pin the parts a
// later edit can weaken with every check still green: the threshold, the page
// set, and the gate split.
describe('accessibility gate configuration', () => {
  test('gates on serious as well as critical violations', () => {
    // The confirmed decision on the issue is critical + serious, explicitly
    // broader than "critical only".
    expect([...FAILING_IMPACTS].sort()).toEqual(['critical', 'serious']);
  });

  test('audits the home page plus a sample of API pages', () => {
    expect(REPRESENTATIVE_PAGES).toContain('/');

    const apiPages = REPRESENTATIVE_PAGES.filter((p) => p.startsWith(API_ROOT));
    expect(apiPages.length).toBeGreaterThan(1);
  });

  test('audits at least one page that mounts the custom interactive components', () => {
    // A class page is the one that mounts the lazy API sidebar, the language
    // tab strips and the type tooltips on top of the navbar controls — the
    // JS-driven DOM a static checker cannot reach. Auditing only overview
    // pages would leave exactly that surface ungated.
    expect(
      REPRESENTATIVE_PAGES.some((p) => /aws-cdk-lib\.aws_\w+\.\w+\.html$/.test(p)),
    ).toBe(true);
  });

  test('the audit and the browser e2e suite stay separate gates', () => {
    // Both suites live in test/e2e/ and share one fixture build, so they are
    // split by tag: the e2e task excludes @a11y and the audit task selects
    // it. If either side of that split is dropped the two gates silently
    // merge and a red check stops telling you which one broke.
    const tasks = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '..', '.projen', 'tasks.json'), 'utf-8'),
    );
    const stepsOf = (name: string) =>
      (tasks.tasks[name].steps as { exec?: string }[]).map((s) => s.exec ?? '').join('\n');

    expect(stepsOf('docs:e2e')).toContain('--grep-invert @a11y');
    expect(stepsOf('docs:a11y')).toContain('--grep @a11y');
  });

  test('the audit is not narrowed', () => {
    const audit = fs.readFileSync(
      path.join(import.meta.dirname, 'e2e', 'a11y-audit.spec.ts'),
      'utf-8',
    );

    // Narrowing the audit weakens the gate without any check going red.
    // This has to be exhaustive over AxeBuilder's narrowing surface, not just
    // the obvious verb: `.options({ rules: { x: { enabled: false } } })` turns a
    // rule off without the word `disableRules`, `.exclude()`/`.include()` cut
    // nodes or shrink the audit to a subtree, and `.withTags()` restricts it to
    // a rule subset. Each would leave this file's guarantee false while every
    // check stayed green.
    expect(audit).not.toMatch(
      /disableRules|withRules|withTags|\.exclude\(|\.include\(|FAILING_IMPACTS\s*=/,
    );
    // `.options()` is the one verb that can also WIDEN the audit, by switching
    // on a rule axe ships disabled. It is allowed for that alone: every rule
    // entry it carries must be `enabled: true`, so it can never smuggle a
    // rule off.
    // Extracted by paren balance, not by line shape, and every occurrence must
    // parse: a call this cannot read fails here instead of skipping the loop.
    const optionCalls: string[] = [];
    for (const m of audit.matchAll(/\.options\(/g)) {
      let depth = 1;
      let i = m.index! + m[0].length;
      for (; i < audit.length && depth > 0; i++) {
        if (audit[i] === '(') depth++;
        else if (audit[i] === ')') depth--;
      }
      expect(depth).toBe(0);
      optionCalls.push(audit.slice(m.index! + m[0].length, i - 1));
    }
    expect(optionCalls.length).toBeGreaterThan(0);
    for (const call of optionCalls) {
      const entries = [...call.matchAll(/enabled:\s*(\w+)/g)].map((m) => m[1]);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((v) => v === 'true')).toBe(true);
      expect(call).not.toMatch(/runOnly|resultTypes|selectors|iframes/);
    }
  });

  test('every color pair fixed for the audit clears AA where it renders', () => {
    // The counterpart to the exemption: the colors this repo DOES own are
    // fixed rather than waived. Asserted as a computed ratio, not as a literal
    // hex, so any later lightening fails here instead of passing a pin that
    // only checks the value has not changed.
    //
    // All five pairs are listed because only the audit finds them: code inside
    // a link, the active sidebar entry and the kind badge each need a rendered
    // page to measure. Backgrounds are the values axe measures, several of them
    // composites of a soft tint over a surface, which is exactly why they
    // cannot be re-derived from the stylesheet alone.
    const luminance = (hex: string) => {
      const channel = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const h = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const read = (file: string) =>
      fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', '.vitepress', 'theme', file), 'utf-8');
    const valueOf = (css: string, variable: string) => {
      const match = css.match(new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6})`));
      expect(match).not.toBeNull();
      return match![1];
    };

    const custom = read('custom.css');
    // Code chips in prose and in tables; the last is a tip's warmer surface.
    const CODE_CHIPS = ['#ebebec', '#e7e7e7', '#dedfe3', '#fbecd4'];
    const pairs: [string, string[]][] = [
      // Inline code, and code inside a link — a DIFFERENT variable, and the
      // majority of findings, since the index tables are columns of linked code.
      [valueOf(custom, '--vp-code-color'), CODE_CHIPS],
      [valueOf(custom, '--vp-code-link-color'), CODE_CHIPS],
      // The fenced-block language label, on the code surface.
      [valueOf(custom, '--vp-code-lang-color'), ['#f5f4f1']],
      // The `tip` ramp: the kind badge every API page carries, and tip
      // callouts, both on the soft brand tint composited over the page.
      [valueOf(custom, '--vp-c-tip-1'), ['#fbecd4']],
      // Callout links/code and the active sidebar entry both land on brand-2.
      [valueOf(custom, '--vp-c-brand-2'), ['#dedfe3', '#ebebec', '#f6e7cf']],
    ];
    for (const [foreground, backgrounds] of pairs) {
      for (const background of backgrounds) {
        expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }

    // The decoupled code-theme values are a separate consumer: they apply once
    // a reader picks a code theme, which is why re-pinning them alone did not
    // fix the default page.
    const codeTheme = read('code-theme.css');
    expect(ratio(valueOf(codeTheme, '--vp-code-lang-color'), '#f5f4f1'))
      .toBeGreaterThanOrEqual(4.5);

    // DARK is pinned too, and this is not symmetry for its own sake: the gate
    // audits the default (light) scheme only, so every dark value here is
    // otherwise asserted by comment alone — which is exactly how a dark
    // language label at 3.4:1 reached review. Values are read from the `.dark`
    // block, so a `var()` reference there would fail this on purpose.
    const darkBlock = custom.slice(custom.indexOf('.dark {'));
    const DARK_SURFACES = ['#10161f', '#161e2d', '#1f2a3a'];
    const darkPairs: [string, string[]][] = [
      [valueOf(darkBlock, '--vp-code-color'), DARK_SURFACES],
      [valueOf(darkBlock, '--vp-code-link-color'), DARK_SURFACES],
      [valueOf(darkBlock, '--vp-code-lang-color'), DARK_SURFACES],
      [valueOf(darkBlock, '--vp-c-tip-1'), DARK_SURFACES],
      // The H1 source chip is a link at rest, so brand-2 has to clear AA on
      // the chip's own tint as well as the page. `#232c3b` is that composite
      // in dark (8.17:1); its light sibling `#ebebec` is already above.
      [valueOf(darkBlock, '--vp-c-brand-2'), [...DARK_SURFACES, '#232c3b']],
    ];
    for (const [foreground, backgrounds] of darkPairs) {
      for (const background of backgrounds) {
        expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
    // The dark code-theme label has the same exposure as its light sibling.
    // Anchored on the variable BLOCK, not the first mention of the attribute:
    // the file opens with `html[data-code-theme='dark'] pre span` rules, so a
    // looser anchor reads the light value and passes for the wrong reason.
    const darkCodeTheme = codeTheme.slice(codeTheme.indexOf("data-code-theme='dark'] {"));
    expect(ratio(valueOf(darkCodeTheme, '--vp-code-lang-color'), '#10161f'))
      .toBeGreaterThanOrEqual(4.5);

    // Two fixes are rules, not values, so pin that they still point at the
    // corrected step rather than back at brand-1. The callout rule lives in its
    // own stylesheet because custom.css is variables-only by invariant, so its
    // import is pinned too — an unimported stylesheet fixes nothing.
    const callouts = read('callouts.css');
    expect(callouts).toMatch(/\.custom-block\.note code,?\s*\{?[\s\S]{0,80}--vp-c-brand-2/);
    expect(
      fs.readFileSync(
        path.join(import.meta.dirname, '..', 'docs', '.vitepress', 'theme', 'index.ts'),
        'utf-8',
      ),
    ).toContain('./callouts.css');
    expect(read('api-sidebar.css')).toMatch(
      /\.api-sidebar-link\.active\s*\{[^}]*--vp-c-brand-2/,
    );
    // The source link lives in the type-metadata block rather than the H1,
    // so the brand-2 rule is homed there.
    expect(read('api-layout.css')).toMatch(
      /\.type-metadata-value a\s*\{[^}]*--vp-c-brand-2/,
    );
  });

  test('the accented nesting guide clears 3:1 on the sidebar in light and dark', () => {
    // The accent guide is the only sighted cue for which group holds the
    // current page, so it is a graphical object under WCAG 1.4.11. Its
    // color is read from the rule that draws it, and both the color and the
    // sidebar surface (`--vp-sidebar-bg-color` defaults to `--vp-c-bg-alt`)
    // are read from the theme, so a later change to either fails here.
    const luminance = (hex: string) => {
      const channel = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const h = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const theme = (file: string) =>
      fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', '.vitepress', 'theme', file), 'utf-8');
    const valueOf = (css: string, variable: string) => {
      const match = css.match(new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6})`));
      expect(match).not.toBeNull();
      return match![1];
    };

    const sidebar = theme('api-sidebar.css');
    const accent = sidebar.match(/--api-sidebar-guide-accent-color:\s*var\((--[\w-]+)\)/);
    expect(accent).not.toBeNull();
    expect(accent![1]).toBe('--vp-c-brand-1');
    expect(sidebar).toMatch(
      /\.api-sidebar-item\[data-active-parent\] \.api-sidebar-item > \.api-sidebar-link::before[^{]*\{[^}]*--api-sidebar-guide-accent-color[^}]*background-size: 2px 100%/,
    );

    const custom = theme('custom.css');
    const dark = custom.slice(custom.indexOf('.dark {'));
    expect(ratio(valueOf(custom, accent![1]), valueOf(custom, '--vp-c-bg-alt')))
      .toBeGreaterThanOrEqual(3);
    expect(ratio(valueOf(dark, accent![1]), valueOf(dark, '--vp-c-bg-alt')))
      .toBeGreaterThanOrEqual(3);
  });

  test('the audit workflow is projen-generated, not hand-written YAML', () => {
    // Acceptance criterion on the issue. projen marks what it owns in
    // .gitattributes, so a hand-written workflow is detectable: it would be
    // absent from that list and drift on the next synth.
    const gitattributes = fs.readFileSync(
      path.join(import.meta.dirname, '..', '.gitattributes'),
      'utf-8',
    );
    expect(gitattributes).toContain('/.github/workflows/docs-a11y.yml linguist-generated');
  });
});
