# Brand Theme and Icons

## Status

Accepted

## Context

The site mirrors the official AWS reference documentation and must carry a
matching AWS identity in both light and dark mode while keeping every
default-theme feature working. VitePress offers three customization levels —
CSS variable overrides, slot injection, and a fully custom theme — and the
brand is built from the lightest two: variable overrides plus a few slot
components. Visual chrome must also stay within WCAG AA contrast, within the
site's size budget, and clear of brand marks the project has no license
to display.

## Decision

### Palette

Extend the default theme with CSS variable overrides only
(`docs/.vitepress/theme/index.ts` re-exports the default theme and imports
`custom.css`). The identity is an AWS orange (`#ff9900`) brand ramp on
squid-ink (`#232f3e`) accents. Light and dark are tuned independently: `:root`
carries light mode (orange darkened to brand-1 `#b45309` / brand-2 `#92400e`
for contrast on light surfaces), `.dark` carries dark mode (full-brightness
orange on squid-ink surfaces). Every variable in `:root` that sets a text
color MUST be re-declared in `.dark` with an explicit value — `custom.css`
loads after the default theme and `:root` matches `<html>` at equal
specificity, so an unshadowed `:root` value silently wins in dark mode and
produces dark-on-dark text.

Light surfaces are a warm off-white rather than pure white, which reads as
glary against high-contrast squid-ink text on large API pages:
`--vp-c-bg: #faf9f7` for content, `#f5f4f1` for
`--vp-c-bg-alt`/`--vp-c-bg-soft`/`--vp-c-bg-elv`. Dark surfaces are
`#161e2d` / `#10161f` / `#1f2a3a` with `#e2e8f0` body text. Brand buttons use
dark-ink text on orange in both modes (white on `#ff9900` is only 2.1:1).
Overrides are limited to documented `--vp-*` variables, so VitePress upgrades
stay low-risk. Every text/surface pair meets AA (>= 4.5:1), enforced by
`test/theme.test.ts`.

### Logo and copyright

The navbar carries the AWS company logo, matching the reference documentation,
rather than a per-product CDK icon. `themeConfig.logo` is
`{ src: "/aws-logo-gray.svg", alt: "AWS" }`; the logo and site title link home.
Only one asset is committed (`docs/public/aws-logo-gray.svg`, fill `#161d26`,
legible on light). `nav-controls.css` paints it white in dark mode with
`.dark .VPNavBarTitle .logo { filter: brightness(0) invert(1); }` —
`brightness(0)` flattens the gray mark to black first, so inverting yields true
white (a plain `invert(1)` on a dark fill gives a pale tan). A single asset is
deliberate: VitePress renders a `{ light, dark }` logo pair as two `<img>`
elements, hides one with `display: none`, and a cold load fetches both, paying
for an asset no reader sees. `test/theme.test.ts` asserts the single-asset
shape and `test/e2e/logo.spec.ts` asserts the dark-mode filter on rendered
pixels, so reintroducing a pair fails the suite. The logo is decorative inside
the named home link; its former `alt: "AWS"` rule is superseded by
[navbar title lockup](./2026-10-23-navbar-title-lockup.md).

The AWS company mark carries no public redistribution grant; the license for it
is owned, recorded here from the maintainer rather than inferred, because a
future contributor cannot re-derive it from the repository.

The footer carries the AWS reference-docs copyright wording with the year
computed at build time:
`© {year}, Amazon Web Services, Inc. or its affiliates. All rights reserved.`
An annual rebuild keeps it current without a source change. Footer structure is
covered by [navbar, footer, and layout](./2026-10-15-navbar-footer-and-layout.md).

### No third-party brand marks in the chrome

No mark belonging to someone else appears in the site chrome. The language
selector segments show text abbreviations — `TS` / `Py` / `Ja` / `C#` / `Go` —
from `LANGUAGE_SHORT_LABELS` in `languages-core.ts`, in the existing 22×20 box
so the 40px control height and search-box baseline alignment are unchanged.
`devicon` and `simple-icons` are not dependencies. The framework GitHub link
(targeting `aws/aws-cdk`, the library a reference reader wants) is the first
text entry in the footer's community row, not a navbar `socialLinks` icon.
`nav-controls.test.ts` asserts the absence directly — no theme file names
either package and neither is a dependency — so a future change reaching for a
brand mark fails the suite. This covers chrome only; page-content glyphs
(below) are owned by no brand and are unaffected.

- Rejected: rendering a trademarked logomark cleanly via import settles
  attribution and theming, not permission; a logomark is a trademark whatever
  the rendering mechanism, and that exposure is not worth taking on for chrome.

### Site and code-block theme controls

A custom `ThemePicker.vue` provides two tri-state segmented controls, replacing
VitePress's built-in two-state switch (hidden via `theme-picker.css`). On
desktop the pickers live behind a gear-icon Settings dropdown (`SettingsMenu`);
on mobile they render in the hamburger nav screen.

- **Site theme** (Light / Device / Dark). `appearance` stays at its default
  (`true`), so a fresh visitor already follows the OS, live. The picker runs
  its own VueUse `useColorMode` on the same storage key
  `vitepress-theme-appearance` with the same mode-to-class mapping VitePress
  uses, so the two cannot diverge; `'auto'` ("Device") means follow
  `prefers-color-scheme`, identical to having no stored preference. The key is
  mirrored from VitePress client source (not publicly re-exported) and a test
  asserts the mirror matches the installed VitePress so an upstream rename fails
  the build.
- **Code theme** (Light / Default / Dark). Code fences are highlighted at build
  time with Shiki dual themes, so both palettes already ride every token as
  `--shiki-light` / `--shiki-dark`; an independent code theme is CSS-only, with
  no second Shiki pass and no extra page weight. State is tri-state in
  localStorage `cdk-docs-code-theme` (`code-theme.ts`). In the `'auto'`
  ("Default") state the attribute is removed entirely and the stock
  `.dark`-keyed rules drive the blocks, so following the site theme is
  structural and cannot drift. An explicit Light/Dark sets
  `data-code-theme="light|dark"` on `<html>`; `code-theme.css` re-keys both the
  token colors (`pre.vp-code span`) and the `--vp-code-*` chrome vars off that
  attribute (specificity 0,1,1 out-specifies `:root`/`.dark`, no `!important`),
  so a light code block on a dark page sits on a light surface. Inline `code`
  spans in prose keep following the site theme. A pre-hydration inline script in
  `config.mts` re-applies a stored decoupled choice before first paint, so a
  reload never flashes the wrong colors.

Both groups pin `height: 40px; box-sizing: border-box` to align with the search
trigger and language slider. The e2e suite asserts both tri-states cycle,
Default follows the site theme including Device, decoupled rendering both ways,
and persistence across reloads.

- Rejected: `force-dark`/`force-auto` (removes user override); writing
  localStorage directly (invisible to VitePress's reactive instance in-tab);
  re-highlighting per code theme (highlighting is ~35% of shard build time and
  the dual-theme vars already carry both palettes); a class-based code switch
  (an attribute with explicit values is self-documenting and cannot collide
  with VitePress class usage).

### Home page feature icons

The four home-page feature cards use `lucide-static` glyphs — `book-open`,
`compass`, `bot`, `blocks` — each chosen to carry the card's meaning. These are
generic concept icons owned by no brand, distinct from the chrome marks above.
`docs/index.md` names each as a `lucide:<name>` token in `features[].icon`
frontmatter, and a `transformPageData` hook in `config.mts`
(`resolveLucideIcon` in `feature-icons.ts`) resolves the token to an inline SVG
string at build time, rewriting the stroke to `stroke-width="1.5"`,
`aria-hidden="true"`, and `currentColor`. The rendered value must be inline
markup because VitePress reads `features[].icon` from frontmatter (which cannot
`import`); the icon must be a plain string, not `{ svg }`, since VitePress
routes an object icon to `VPImage`, which renders an empty slot. An unknown
token or missing source file throws and fails the build. The tint rule lives in
`home-features.css` (not `custom.css`, which `test/theme.test.ts` constrains to
variable blocks only): one `color: var(--vp-c-brand-1)` tints all four in both
palettes. `test/landing-page.test.ts` pins each card's token to its glyph.
Adding a card is one token plus one pin entry.

- Rejected: a Vue component importing `?raw` (gives up native `VPFeatures`
  layout); `<img>` from generated `docs/public/` SVGs (cannot inherit
  `currentColor`, needs light/dark pairs and extra requests against the
  Lighthouse budget).

### Monochrome UI glyphs as CSS masks

The ten first-party stroke glyphs in `docs/.vitepress/theme/icons/`
(`sun`, `moon`, `monitor`, `code`, `link`, `gear`, `clear`, `enter`, `locate`,
`top`) render as CSS `mask-image`, not inline SVG. An empty `aria-hidden` span
with class `.glyph .glyph-<name>` carries the mask; `background-color:
currentColor` paints it, so each glyph follows the theme. `glyphs.css` declares
one `url("./icons/<name>.svg")` per glyph and Vite inlines each small file as a
data URI into the single hashed stylesheet, fetched once with the CSS instead of
riding inline on every one of the ~23,600 pages. A mask uses the image's alpha
only, so a glyph needing more than one color cannot be a mask and would return
to inline SVG. The landing-page Lucide icons (page content) and VitePress's own
search-button glyph stay inline.

The site ships no source maps. The theme bundle has no debugging audience and a
map roughly triples the JavaScript bytes against the Pages size ceiling.
Lighthouse's `valid-source-maps` audit is red by this decision; it is a
best-practices audit and the gate runs `--only-categories=performance`, so it
cannot affect the gate.

## Consequences

- Every default-theme feature keeps working — no components are forked — and
  deeper personality changes extend this same theme entry, the supported path.
- Chrome brands the site by company, matching the reference docs it mirrors;
  the home-link naming rule is superseded by
  [navbar title lockup](./2026-10-23-navbar-title-lockup.md).
- One ~4 KB logo SVG is committed under the theme and fetched once per cold
  load.
- Removing inline chrome `<svg>` cuts a construct page from 16 inline SVG to 1
  and the home page from 19 to 5 (the Lucide icons plus VitePress's search
  glyph); the shared stylesheet grows once and is cached across every page.
- The decoupled code-chrome values in `code-theme.css` mirror the surface stacks
  in `custom.css` and VitePress's `vars.css` and must be kept in sync if those
  change; each value is annotated with its source.
- The AWS logo's licensing basis rests on a maintainer-recorded grant rather
  than a self-evident redistribution license, which is why it is written down.
