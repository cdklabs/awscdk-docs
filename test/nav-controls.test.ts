import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// vitepress-plugin-pagefind hard-codes its search trigger at this height
// with no CSS variable exposed, so the nav controls pin the same literal
// value here rather than depending on the plugin's internal source layout.
const PAGEFIND_SEARCH_TRIGGER_HEIGHT_PX = 40;

// Navbar layout:
// - the language tabs take the LEADING slot, right after the site title,
//   where the stock theme puts search,
// - the search box moves to the CENTER of the nav row,
// - the two tri-state theme groups (Site + Code) sit behind the gear-icon
//   Settings dropdown, because two of them inline crowd the row,
// - the medium-view duplicate appearance switch (VitePress's "extra"
//   flyout embeds its own VPSwitchAppearance between 768-1279px) stays
//   hidden so exactly one appearance control is reachable everywhere.
describe('navbar layout', () => {
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
  const css = readFileSync(resolve(THEME_DIR, 'nav-controls.css'), 'utf-8');
  const picker = readFileSync(resolve(THEME_DIR, 'ThemePicker.vue'), 'utf-8');
  const menuPath = resolve(THEME_DIR, 'SettingsMenu.vue');
  const toggle = readFileSync(
    resolve(THEME_DIR, 'LanguageToggle.vue'),
    'utf-8',
  );

  describe('theme picker behind the Settings dropdown', () => {
    test('the Settings dropdown hosts the picker instead of the nav row', () => {
      expect(existsSync(menuPath)).toBe(true);
      const menu = readFileSync(menuPath, 'utf-8');
      // The dropdown owns the placement; the picker keeps its state model
      // and is rendered as the panel's content.
      expect(menu).toContain('import ThemePicker from "./ThemePicker.vue"');
      expect(menu).toContain('<ThemePicker');
      expect(entry).toContain('import SettingsMenu from "./SettingsMenu.vue"');
      // The tabs still lead and the gear still closes the row; the
      // aws-cdk-lib version badge sits between them.
      expect(entry).toMatch(
        /"nav-bar-content-after":\s*\(\)\s*=>\s*\[\s*h\(LanguageToggle\),(?:\s*h\(\w+\),)*\s*h\(SettingsMenu\)\s*\]/,
      );
      // The picker is not inline in the nav row, so a placement rule for that
      // position must not linger as dead CSS.
      expect(css).not.toMatch(
        /\.content-body\s*>\s*\.ThemePicker\s*\{[^}]*margin-left/,
      );
      expect(css).toMatch(
        /\.content-body\s*>\s*\.SettingsMenu\s*\{[^}]*margin-left/,
      );
    });

    test('the trigger implements the disclosure contract', () => {
      const menu = readFileSync(menuPath, 'utf-8');
      // A real button, so Enter/Space toggle natively.
      expect(menu).toMatch(/<button[^>]*type="button"/s);
      expect(menu).toContain('aria-label="Settings"');
      expect(menu).toContain(':aria-expanded="open"');
      expect(menu).toContain('aria-controls="settings-menu-panel"');
      expect(menu).toContain('id="settings-menu-panel"');
      // Escape closes and returns focus to the trigger; an outside click
      // closes without trapping focus anywhere.
      expect(menu).toMatch(/event\.key === "Escape"/);
      expect(menu).toMatch(/trigger\.value\?\.focus\(\)/);
      expect(menu).toContain('addEventListener("click", onDocumentClick)');
      expect(menu).toContain('removeEventListener("click", onDocumentClick)');
    });

    test('the trigger sits level with the 40px search trigger', () => {
      // Inside the popover the picker's groups need not match the nav row's
      // baseline, but the gear trigger standing in for them does.
      const menu = readFileSync(menuPath, 'utf-8');
      const triggerHeight = menu.match(
        /\.settings-trigger\s*\{[^}]*?height:\s*(\d+)px/,
      );
      expect(triggerHeight).not.toBeNull();
      expect(Number(triggerHeight![1])).toBe(PAGEFIND_SEARCH_TRIGGER_HEIGHT_PX);
      expect(menu).toMatch(
        /\.settings-trigger\s*\{[^}]*box-sizing:\s*border-box/,
      );
      // WCAG 2.5.8 (Target Size, Minimum) on the trigger's narrow axis.
      const triggerWidth = menu.match(
        /\.settings-trigger\s*\{[^}]*?width:\s*(\d+)px/,
      );
      expect(triggerWidth).not.toBeNull();
      expect(Number(triggerWidth![1])).toBeGreaterThanOrEqual(24);
    });

    test('the panel labels each group in visible text, not icons alone', () => {
      // The popover has the room the nav row did not, so the groups get
      // real captions instead of relying on the decorative glyph that
      // distinguished them side by side.
      expect(picker).toContain('groupLabels');
      expect(picker).toMatch(/class="theme-picker-group-label"/);
      const menu = readFileSync(menuPath, 'utf-8');
      expect(menu).toMatch(/<ThemePicker\s+group-labels/);
    });

    test('each state is an icon button that keeps its accessible name', () => {
      // Icon-only buttons: an aria-hidden masked glyph per state, with the
      // descriptive `title` strings doubling as aria-labels ("Light site
      // theme" / "Light code blocks" / ...) so the two groups' buttons
      // stay distinguishable by accessible name alone — the group
      // aria-label scopes locators but is not part of a button's name.
      expect(picker).toContain(':aria-label="option.title"');
      expect(picker).toMatch(/class="glyph glyph-\w+ theme-picker-icon"/);
      expect(picker).toContain('aria-hidden="true"');
      expect(picker).toContain('aria-label="Site theme"');
      expect(picker).toContain('aria-label="Code theme"');
      // Sun for light, monitor for device (auto), moon for dark.
      expect(picker).toMatch(/v-if="option\.value === 'light'"/);
      expect(picker).toMatch(/v-else-if="option\.value === 'auto'"/);
      // The active state stays programmatically indicated. Both the class
      // and aria-pressed are gated on `mounted` so the pair cannot disagree:
      // ungated, the class survives hydration unpatched while aria-pressed
      // does not, leaving the picker showing the middle option active
      // whatever the reader had stored.
      expect(picker).toContain(':aria-pressed="mounted && mode === option.value"');
      expect(picker).toContain(':aria-pressed="mounted && codeTheme === option.value"');
      expect(picker).toContain(':class="{ active: mounted && mode === option.value }"');
      expect(picker).toContain(':class="{ active: mounted && codeTheme === option.value }"');
    });
  });

  describe('language tabs', () => {
    test('is a segmented radio-group picker that names every language', () => {
      expect(toggle).toContain('role="radiogroup"');
      expect(toggle).toContain('aria-label="Select programming language"');
      expect(toggle).toContain('role="radio"');
      expect(toggle).toContain(':aria-checked="lang === activeLanguage"');
      expect(toggle).toMatch(/class="language-abbr" :data-lang="lang"/);
      expect(toggle).toContain('LANGUAGE_SHORT_LABELS[lang]');
      expect(toggle).not.toContain('<svg');
      // The visible abbreviation stays inside the accessible name: no
      // aria-label replacing it, no aria-hidden removing it.
      expect(toggle).not.toContain(':aria-label="LANGUAGE_LABELS[lang]"');
      expect(toggle).not.toMatch(/class="language-abbr"[^>]*aria-hidden/);
      expect(toggle).toMatch(
        /v-if="lang !== activeLanguage" class="visually-hidden">\{\{\s*LANGUAGE_LABELS\[lang\]/,
      );
      expect(toggle).toMatch(/\.visually-hidden \{[^}]*clip: rect\(0 0 0 0\)/);
      // The active language is programmatically indicated (aria-checked);
      // its visible non-color cue is the bar's underline, pinned below.
      expect(toggle).toMatch(/v-if="lang === activeLanguage"[^>]*class="language-label"/);
      // The badges are not painted in the bar or the menu. That the unchecked
      // names paint at full width is checked in the browser
      // (language-toggle.spec.ts).
      expect(css).toMatch(
        /:is\(\.VPNavBar, \.VPNavScreen\) \.language-toggle \.language-option \.language-abbr \{\s*display: none;/,
      );
      // The bar draws the options as text tabs: a 3px bottom border on every
      // option, transparent when idle and brand-colored on the selected one,
      // which also takes the brand text color and no fill. The border is part
      // of every tab's box, so selecting never changes a tab's size.
      expect(css).toMatch(
        /\.VPNavBar \.language-toggle \.language-option \{[^}]*border-top: 3px solid transparent;\s*border-bottom: 3px solid transparent;/,
      );
      // Forced colors paints transparent borders in the system text color, so
      // the never-painted top border and the idle bottom borders take the
      // canvas color there (checked in the browser in language-toggle.spec.ts).
      const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
      expect(forced).toMatch(
        /\.VPNavBar \.language-toggle \.language-option \{\s*border-top-color: Canvas;/,
      );
      expect(forced).toMatch(
        /\.VPNavBar \.language-toggle \.language-option:not\(\.active\) \{\s*border-bottom-color: Canvas;/,
      );
      expect(css).toMatch(
        /\.VPNavBar \.language-toggle \.language-option\.active \{\s*color: var\(--tb-tab-on\);\s*border-bottom-color: var\(--tb-tab-on\);\s*background-color: transparent;/,
      );
      expect(css).toMatch(/--tb-tab-on: var\(--vp-c-brand-1\);/);
      // No track chrome is left in the component for either placement to undo.
      expect(toggle).not.toMatch(/\.language-toggle\s*\{[^}]*(border|border-radius|background-color|height):/);
      expect(toggle).not.toMatch(/\.language-option\.active\s*\{/);
      // Under 1100px only TypeScript shortens, to its badge text "TS"; the
      // full name is taken out of flow rather than removed, so it still
      // names the option there.
      const narrow = css.slice(css.indexOf('@media (max-width: 1099px)'));
      expect(narrow).toContain('.language-abbr[data-lang="ts"]');
      const tsHidden = narrow.slice(
        narrow.indexOf('.active .language-label {'),
        narrow.indexOf('}', narrow.indexOf('.active .language-label {')),
      );
      expect(tsHidden).toContain('position: absolute');
      expect(tsHidden).toContain('clip-path: inset(50%)');
      expect(tsHidden).not.toContain('display: none');
    });

    test('the phone menu stacks the languages as one segmented control', () => {
      const phone = css.slice(css.lastIndexOf('@media (max-width: 767px)'));
      const group = phone.slice(
        phone.indexOf('.VPNavScreen .language-toggle[role="radiogroup"] {'),
        phone.indexOf('}', phone.indexOf('.VPNavScreen .language-toggle[role="radiogroup"] {')),
      );
      expect(group).toContain('flex-direction: column');
      expect(group).toContain('border: 1px solid var(--seg-edge)');
      expect(group).toContain('border-radius: 8px');
      const row = phone.slice(
        phone.indexOf('.VPNavScreen .language-toggle .language-option {'),
        phone.indexOf('}', phone.indexOf('.VPNavScreen .language-toggle .language-option {')),
      );
      expect(row).toContain('min-height: 48px');
      expect(phone).toMatch(
        /\.VPNavScreen \.language-toggle \.language-option\.active \{\s*background: var\(--seg-on-bg\);\s*color: var\(--seg-on-fg\);/,
      );
    });

    test('no third-party brand mark reaches the theme or its dependencies', () => {
      const files = readdirSync(THEME_DIR, { recursive: true, encoding: 'utf-8' })
        .filter((f) => /\.(vue|ts|css|mts)$/.test(f));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(resolve(THEME_DIR, file), 'utf-8');
        expect(source).not.toMatch(/devicon|simple-icons/);
      }
      const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
      const deps = { ...manifest.dependencies, ...manifest.devDependencies };
      expect(Object.keys(deps)).not.toContain('devicon');
      expect(Object.keys(deps)).not.toContain('simple-icons');
      const long = [...toggle.matchAll(/"(M[\d.\-\s,a-zA-Z]{60,})"/g)];
      expect(long).toHaveLength(0);
      expect(existsSync(resolve(THEME_DIR, 'language-icons.ts'))).toBe(false);
    });

    test('every enabled language has a badge abbreviation', () => {
      const vocabulary = readFileSync(resolve(THEME_DIR, 'languages-core.ts'), 'utf-8');
      const block = /LANGUAGE_SHORT_LABELS: Record<TabLanguage, string> = \{([^}]*)\}/.exec(vocabulary);
      expect(block).not.toBeNull();
      for (const [lang, abbr] of Object.entries({
        ts: 'TS',
        python: 'Py',
        java: 'Ja',
        dotnet: 'C#',
        go: 'Go',
      })) {
        expect(block![1]).toContain(`${lang}: '${abbr}'`);
      }
      const values = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(new Set(values).size).toBe(values.length);
    });

    test('keeps driving the shared language state (no forked state)', () => {
      expect(toggle).toContain('from "./language-state"');
      expect(toggle).toContain('setLanguage(');
      expect(toggle).toContain('activeLanguage');
      // Still renders only when the build enables 2+ languages, so the
      // ts-only Model B invariant holds (no dead single-option control).
      expect(toggle).toContain('LANGUAGE_TOGGLE_VISIBLE');
    });

    test('implements the roving-tabindex keyboard pattern', () => {
      expect(toggle).toContain(':tabindex="lang === activeLanguage ? 0 : -1"');
      for (const key of ["'ArrowRight'", "'ArrowLeft'", "'Home'", "'End'"]) {
        expect(toggle).toContain(`case ${key.replace(/'/g, '"')}`);
      }
    });

    test('leads the nav row while the search centers', () => {
      // The tab group takes the leading slot via flex ordering, where the stock
      // theme puts search;
      // the search keeps the pagefind plugin's flex-grow and centers its
      // trigger inside the middle region. Both overrides only fire when
      // the tabs actually render (`:has()`), so the single-language
      // build keeps the stock layout. The selector is the `.search`
      // passthrough class, NOT .VPNavBarSearch — the pagefind plugin
      // aliases that component away.
      expect(css).toMatch(/>\s*\.language-toggle\s*\{[^}]*order:\s*-2/);
      expect(css).toMatch(
        /\.content-body:has\(>\s*\.language-toggle\)\s*>\s*\.search\s*\{[^}]*order:\s*-1/,
      );
      expect(css).toMatch(
        /\.content-body:has\(>\s*\.language-toggle\)\s*>\s*\.search\s*\{[^}]*justify-content:\s*center/,
      );
      // The search must NOT lose its flex-grow — that is what makes it
      // own (and center within) the middle region.
      expect(css).not.toMatch(/>\s*\.search\s*\{[^}]*flex:\s*0/);
    });

    test('the nav geometry does not depend on the page', () => {
      // VitePress keys four geometry rules on its own `has-sidebar` class,
      // which in this repo is set on /api/** but not on / (layout: home) or
      // /skills (themeConfig.sidebar is keyed only on /api/). Bringing the
      // non-sidebar pages onto the same full-width geometry is what stops
      // the leading tabs and the centered search trigger moving between
      // page types.
      //
      // The pin is a MIRROR of VitePress's own has-sidebar declarations,
      // read out of the installed package the same way the search-height
      // test does: a vitepress upgrade that changes this geometry then
      // fails here instead of silently letting the two page types diverge
      // again. Each selector's own declarations are compared — not a
      // whole-file `toContain`, which passes on a rule whose declarations
      // have been gutted.
      const stock = readFileSync(
        resolve(
          ROOT,
          'node_modules/vitepress/dist/client/theme-default/components/VPNavBar.vue',
        ),
        'utf-8',
      );
      const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Comments are stripped from both sides before anything is matched.
      // These blocks are heavily commented and the prose quotes selectors
      // verbatim, so a check run against the raw text would read a sentence
      // about a rule as the rule itself.
      const stripped = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '');
      const rules = stripped(css);
      const stockRules = stripped(stock);
      // Declarations of every block whose selector list ENDS with this
      // selector, in source order.
      const blocks = (src: string, selector: string) =>
        [...src.matchAll(new RegExp(`${escape(selector)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) =>
          m[1]
            .split(';')
            .map((d) => d.trim().replace(/\s+/g, ' '))
            .filter(Boolean),
        );
      // The nearest enclosing @media condition of each of those blocks.
      const tiers = (src: string, selector: string) =>
        [...src.matchAll(new RegExp(`${escape(selector)}\\s*\\{`, 'g'))].map((m) => {
          const preceding = [
            ...src.slice(0, m.index).matchAll(/@media ([^{]+)\{/g),
          ].pop();
          return preceding ? preceding[1].trim() : '';
        });

      const PAIRS: Array<[string, string]> = [
        ['.VPNavBar:not(.has-sidebar) .wrapper', '.VPNavBar.has-sidebar .wrapper'],
        ['.VPNavBar:not(.has-sidebar) .container', '.VPNavBar.has-sidebar .container'],
        [
          '.VPNavBar:not(.has-sidebar) > .wrapper > .container > .title',
          '.VPNavBar.has-sidebar .title',
        ],
        ['.VPNavBar:not(.has-sidebar) .content', '.VPNavBar.has-sidebar .content'],
      ];
      for (const [ours, theirs] of PAIRS) {
        const mine = blocks(rules, ours);
        const stockDecls = blocks(stockRules, theirs);
        expect(stockDecls.length).toBeGreaterThan(0);
        expect(mine).toEqual(stockDecls);
        // …and in the same breakpoint tiers, or the inset diverges again at
        // whichever width the mirrored tier is missing.
        expect(tiers(rules, ours)).toEqual(tiers(stockRules, theirs));
      }

      // Spelled out as well, so the intent survives a refactor of the
      // comparison above: the row's left inset is the sidebar width and the
      // container is unconstrained.
      expect(rules).toMatch(
        /\.VPNavBar:not\(\.has-sidebar\) \.content \{[^}]*padding-left: var\(--vp-sidebar-width\)/,
      );
      expect(rules).toMatch(
        /\.VPNavBar:not\(\.has-sidebar\) \.container \{[^}]*max-width: 100%/,
      );

      // The title selector must stay a CHILD chain. These rules are
      // unscoped, and `.title` is also the anchor inside VPNavBarTitle — a
      // bare descendant selector would absolutely position that anchor at
      // the sidebar width.
      expect(rules).not.toMatch(/\.VPNavBar:not\(\.has-sidebar\) \.title\s*\{/);

      // Page geometry, so NOT gated on the tabs' presence the way the
      // control-arrangement rules above are: the single-language build gets
      // the same one-shape-everywhere bar. A gated selector would not match
      // the pattern the mirror comparison above uses, so that comparison
      // fails on an empty array; this pins the selector text as well.
      expect(rules).not.toMatch(
        /:not\(\.has-sidebar\):has\(> \.language-toggle\)|:has\(> \.language-toggle\)[^{]*:not\(\.has-sidebar\)/,
      );

      // The two COSMETIC has-sidebar rules are not mirrored onto the
      // non-sidebar pages. They are turned off on the sidebar pages rather
      // than mirrored here, so only the mirror is forbidden — the browser
      // assertions in the e2e spec are what pin the result.
      expect(rules).not.toMatch(/:not\(\.has-sidebar\)[^{]*\.divider\s*\{/);
      expect(rules).not.toMatch(
        /:not\(\.has-sidebar\)[^{]*\{[^}]*border-bottom-color/,
      );
    });

    test('spans the full height of the control row', () => {
      // The tabs stretch to the bar's full height so the selected underline
      // sits on the bar's bottom edge; no fixed height competes with that.
      // The search trigger, version and gear keep their 40px baseline.
      expect(css).toMatch(
        /\.VPNavBar \.content-body > \.language-toggle \{\s*align-self: stretch;\s*\}/,
      );
      expect(toggle).not.toMatch(/\.language-toggle\s*\{[^}]*height:/);
      expect(css).toMatch(/\.version-badge \{[^}]*height: 40px/);
    });

    test('the tabs trade padding for width down to 960px, then their minimum', () => {
      // One variable carries the side padding so each tier changes one number:
      // 14px on desktop, 10px under 1280px, 8px in the 960-1023px band, where
      // the fixed title lane leaves the least room and the 44px tab floor also
      // yields. Below 960px the title is logo-only, so the band reuses 10px.
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(stripped).toMatch(/\n:root \{[^}]*--tab-pad: 14px;/);
      expect(stripped).toMatch(
        /@media \(max-width: 1279px\) \{\s*:root \{\s*--tab-pad: 10px;/,
      );
      const tightStart = stripped.indexOf('@media (min-width: 960px) and (max-width: 1023px) {');
      expect(tightStart).toBeGreaterThan(-1);
      const tight = stripped.slice(tightStart, stripped.indexOf('\n}\n', tightStart));
      expect(tight).toContain('--tab-pad: 8px;');
      expect(tight).toMatch(/\.language-option \{\s*min-width: 0;/);
      expect(stripped).toMatch(
        /\.VPNavBar \.language-toggle \.language-option \{[^}]*min-width: 44px;[^}]*padding: 0 var\(--tab-pad\);/,
      );
      // Nothing else sets a padding on the bar's options, or the tiers would
      // not be the only knob.
      const barOptionRules = [...stripped.matchAll(/\.VPNavBar \.language-toggle \.language-option \{([^}]*)\}/g)]
        .map((m) => m[1]);
      expect(barOptionRules.filter((r) => /padding/.test(r))).toHaveLength(1);
    });

    test('the search trigger is outlined on the bar, bare on the phone row', () => {
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(stripped).toMatch(
        /\.VPNavBar \.content-body > \.search \.nav-search-btn-wait \{\s*background-color: var\(--vp-c-bg\);\s*border: 1px solid var\(--tb-input-border\);\s*border-radius: 20px;\s*color: var\(--tb-muted\);/,
      );
      expect(stripped).toMatch(
        /\.nav-search-btn-wait:hover \{\s*border-color: var\(--tb-focus\);\s*box-shadow: 0 0 0 1px var\(--tb-focus\);/,
      );
      expect(stripped).toMatch(
        /\.nav-search-btn-wait:focus-visible \{\s*outline: 2px solid var\(--tb-focus\);\s*outline-offset: 2px;/,
      );
      // 768-959px drops the padding only when the tabs render, because only
      // then are the label and hint out of flow; a single-language build keeps
      // its label and its padding.
      expect(stripped).toMatch(
        /@media \(min-width: 768px\) and \(max-width: 959px\) \{\s*\.VPNavBar \.content-body:has\(> \.language-toggle\) > \.search \.nav-search-btn-wait \{\s*padding: 0;\s*border-radius: 50%;/,
      );
      // Below 768px the plugin's bare icon returns: no edge, no fill, no radius.
      const phone = stripped.slice(stripped.indexOf('@media (max-width: 767px)'));
      expect(phone).toMatch(
        /\.nav-search-btn-wait \{\s*width: 48px;\s*height: 100%;\s*border: 0;\s*border-radius: 0;\s*box-shadow: none;\s*background-color: transparent;/,
      );
    });

    test('every bar, dropdown and menu control has a 44px floor below 960px', () => {
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const start = stripped.indexOf('@media (max-width: 959px)');
      expect(start).toBeGreaterThan(-1);
      const block = stripped.slice(start, stripped.indexOf('\n}\n', start));
      expect(block).toMatch(/\.nav-search-btn-wait \{\s*height: 44px;\s*min-width: 44px;/);
      expect(block).toMatch(/\.version-badge \{\s*height: 44px;\s*min-width: 44px;/);
      expect(block).toMatch(/\.settings-trigger \{\s*width: 44px;\s*height: 44px;/);
      expect(block).toMatch(/\.VPNavBarTitle \.title \{\s*min-width: 44px;/);
      // The pickers in the hamburger menu and in the Settings dropdown (which
      // the gear still opens at 768-959px).
      expect(block).toMatch(
        /\.VPNavScreen \.NavStylePicker \.nav-style-option,\s*\.VPNavBar \.SettingsMenu \.theme-picker-option,\s*\.VPNavBar \.SettingsMenu \.nav-style-option \{\s*min-width: 44px;\s*min-height: 44px;/,
      );
      // The 40px tracks grow with their segments, and the theme picker wraps
      // rather than overflowing a 320px menu.
      expect(block).toMatch(/\.VPNavBar \.SettingsMenu \.nav-style-group \{\s*height: auto;/);
      expect(block).toMatch(/\.ThemePicker \{\s*flex-wrap: wrap;\s*gap: 8px;/);
    });

    test('is reachable at narrow widths through the nav screen', () => {
      const navScreen = entry.match(/"nav-screen-content-after":\s*\(\)\s*=>\s*\[([^\]]*)\]/);
      expect(navScreen).not.toBeNull();
      expect(navScreen![1]).toContain('h(LanguageToggle)');
      expect(css).toMatch(/\.VPNavScreen \.language-toggle/);
    });
  });

  describe('no nested dropdown on touch', () => {
    test('the mobile nav screen keeps a direct theme picker row', () => {
      // The hamburger screen has full width and no hover affordance, so
      // the picker is rendered straight into it — burying it a second tap
      // deep would be worse there, not better.
      const navScreen = entry.match(
        /"nav-screen-content-after":\s*\(\)\s*=>\s*\[([^\]]*)\]/,
      );
      expect(navScreen).not.toBeNull();
      expect(navScreen![1]).toContain('h(ThemePicker)');
      expect(navScreen![1]).not.toContain('SettingsMenu');
    });

    test('the navbar copy of the picker is not separately hidden', () => {
      // The dropdown is what hides on narrow viewports, where the nav-screen
      // copy takes over. A .ThemePicker hide rule would also blank the
      // nav-screen row if the selector ever loosened.
      expect(css).toMatch(
        /@media \(max-width: 767px\)[\s\S]*?\.content-body\s*>\s*\.SettingsMenu/,
      );
    });
  });

  describe('single appearance control', () => {
    test('hides the medium-view duplicate inside the extra-navigation flyout', () => {
      expect(css).toMatch(
        /\.VPNavBarExtra \.item\.appearance\s*\{[^}]*display:\s*none/,
      );
    });

    test('hides the whole flyout only while it holds nothing but the appearance item', () => {
      // Conditional, so locale links or social links bring the flyout back.
      expect(css).toMatch(
        /\.VPNavBarExtra:not\(:has\(\.group\.translations,\s*\.item\.social-links\)\)\s*\{[^}]*display:\s*none\s*!important/,
      );
    });

    test('the stock switches stay hidden (theme-picker.css)', () => {
      const pickerCss = readFileSync(
        resolve(THEME_DIR, 'theme-picker.css'),
        'utf-8',
      );
      expect(pickerCss).toMatch(/\.VPNavBarAppearance\s*\{[^}]*display:\s*none/);
      expect(pickerCss).toMatch(/\.VPNavScreenAppearance\s*\{[^}]*display:\s*none/);
    });
  });

  test('nav-controls.css is imported by the theme entry', () => {
    expect(entry).toContain('./nav-controls.css');
  });

});
