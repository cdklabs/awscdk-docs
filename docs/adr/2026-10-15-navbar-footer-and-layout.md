# Navbar, Footer, and Site Layout

## Status

Accepted

## Context

The site extends the VitePress 1.6.x default theme rather than forking it. The
navbar carries custom controls (a language slider, the search box, a version
badge, and appearance pickers), the site needs one footer on **every** page
including the tens of thousands of generated `/api/**` reference pages, and the
whole thing must work on phones. Several defects were only visible across page
types or across the hydration boundary, so the layout rules are written to hold
on every page and from the first painted frame, not just in a settled desktop
state.

All colors and spacing come from VitePress theme variables (`--vp-c-*`,
`--vp-sidebar-width`, `--vp-layout-max-width`), so every rule is light/dark safe
without extra wiring.

## Decision

### Responsive mobile layout via default-theme reuse

Reuse the default theme's mobile structure unchanged — the `VPSidebar`
slide-out drawer below 960px, the `VPLocalNavOutlineDropdown` top-of-page
outline, and the horizontal scrolling of `.vp-doc table` and code blocks — and
add one stylesheet, `docs/.vitepress/theme/responsive.css`, that patches only
our custom layer:

- a horizontal overflow guard (`min-width: 0` on the doc containers,
  `overflow-wrap` on content) so any wide element degrades into local scrolling
  instead of page-level overflow;
- mobile sizing for docgen `pre.signature` blocks (momentum scrolling, tighter
  padding below 768px; generated initializer signatures wrap rather than scroll);
- heading/badge wrapping so title badges never widen the page;
- WCAG 2.5.5 touch targets (>= 44x44px) for the hamburger, TOC dropdown button,
  sidebar drawer rows, and the breadcrumb favorite star, below 960px;
- a full-width Pagefind dialog below 768px with a 16px input font size to stop
  iOS Safari zoom-on-focus.

Breakpoints mirror the default theme's: 768px and 960px. No components are
forked, so VitePress upgrades keep improving the drawer and TOC for free. The
cost is a dependency on stable default-theme class names (`.VPLocalNav`,
`.VPSidebar`, `.search-dialog`); the tests pin our selectors so a rename fails
loudly.

### Site-wide footer via the `layout-bottom` slot

`themeConfig.footer` is deliberately left unset: the default theme's `VPFooter`
renders it only on pages **without** a sidebar, which would hide it from every
generated `/api/**` page. Instead `SiteFooter.vue` mounts in the default theme's
`layout-bottom` slot (`docs/.vitepress/theme/index.ts`), which renders on every
layout. It carries community links (GitHub, cdk.dev Slack, Stack Overflow, AWS
re:Post) and the AWS legal line (Third-party licenses, Privacy, Site terms,
Cookie preferences, and a render-time `© {year}` copyright). The Cookie
preferences link (`id="awsdocs-cookie-preferences-link"`) is bound by
`awsdocs-boot.js` to the Shortbread consent modal.

Because `layout-bottom` sits outside `VPContent`, the footer re-derives the
sidebar offset itself using the theme's own `useSidebar()` composable to toggle
a `has-sidebar` class, mirroring `VPContent`'s offset math:

- `@media (min-width: 960px)`: `padding-left: calc(var(--vp-sidebar-width) + 24px)`
- `@media (min-width: 1440px)`:
  `padding-left: calc((100vw - var(--vp-layout-max-width)) / 2 + var(--vp-sidebar-width) + 24px)`

This is a deliberate coupling to two internal, non-contractual aspects of the
default theme: the `has-sidebar` offset math and the reason the slot was chosen
(`VPFooter` hiding on sidebar pages). On a VitePress bump, diff the default
theme's `VPContent`/`VPSidebar` CSS for `--vp-sidebar-width` and the 960px/1440px
breakpoints and update the two media queries; a drifted `padding-left`
mis-aligns silently with no unit-test failure, so check an `/api/**` page at
>=960px and >=1440px by eye. If a future release lets the native footer render
on sidebar pages, prefer deleting `SiteFooter` and returning to
`themeConfig.footer`.

### Per-page contribution links via the `doc-after` slot

A single component, `PageFooterLinks.vue`, owns the per-page footer row and
mounts via `doc-after`. VitePress's native `editLink` is disabled in
`config.mts`, so this is the sole source of the edit link and no competing copy
can render. There is no client-side vote widget: on a static site with no
backend, votes stored only in the visitor's `localStorage` produce no signal we
can read, so a vote UI would be decorative. If aggregate feedback is ever
wanted it needs a real analytics endpoint, not a client-only widget.

The row reads: *Edit this page · Report an issue* (shortened in
[edit link on type pages](./2026-10-23-type-page-edit-link.md)), with the
"Edit this page" link omitted on generated pages that have no editable source. The edit-URL and report-URL logic, the generated-page rule, and
the "content revised" stamp are owned by
[page feedback, consent, and stamp](./2026-10-15-page-feedback-consent-and-stamp.md);
the optional "Download as Markdown" twin link is owned by
[SEO and agent discoverability](./2026-10-15-seo-and-agent-discoverability.md).

### Navbar control arrangement

VitePress exposes no slot before the search component, so rather than
re-implement the navbar the custom controls stay mounted in the slots the theme
offers and are repositioned with flex `order` in `nav-controls.css`.
`nav-bar-content-after` renders `[LanguageToggle, VersionBadge, SettingsMenu]`;
`nav-screen-content-after` (the mobile hamburger menu) renders
`[LanguageToggle, ThemePicker]`.

- **Language slider leads** (`.language-toggle { order: -2 }`), taking the slot
  the search box used to occupy and the leading gap the search's `padding-left`
  used to provide (now a 10px margin). It is the primary control on a
  multi-language docs site. Its segmented radio-group behavior and glyphs are
  owned by [multi-language](./2026-10-15-multi-language.md).
- **Search is centered** (`.search { order: -1; justify-content: center;
  padding-left: 0 }`), keeping the pagefind plugin's `flex: 1` so it owns the
  region between the slider and the right-hand controls and centers its trigger
  within it. True viewport-centering is not attempted — it breaks the search
  dropdown's anchoring and collides with controls at narrow widths — and
  centering within the free middle region is visually equivalent at real widths.
- **Version badge then Settings gear** sit at the right end.
- The medium-width (768–1279px) `VPNavBarExtra` "extra navigation" flyout
  embeds its own `VPSwitchAppearance`; it is hidden (and its emptied group
  collapsed) so **exactly one appearance control is reachable at every
  breakpoint**. The whole flyout, trigger included, is hidden while it has
  nothing left to show (no locale links and no social links), so the (…)
  button never opens an empty menu; the rule is conditional (`:has()`), so
  adding either brings the flyout back. The stock navbar and nav-screen
  two-state switches are hidden in `theme-picker.css`.

The `order`/centering overrides are gated on
`:has(.VPNavBar .content-body > .language-toggle)`, so a single-language build
(where the slider does not render) keeps the completely stock control
arrangement. Browsers without `:has()` degrade gracefully: the slider still
renders and keeps its leading position (its rule is not gated), only the
search's centering falls back to the theme's default position.

All custom nav controls (slider, search trigger, version badge, Settings
trigger) are pinned to the same 40px rendered height. The pagefind plugin
hard-codes `height: 40px` on `.nav-search-btn-wait` and exposes no variable, so
the value is pinned in each component and guarded by a regression test that
reads the plugin's source.

#### Fitting the medium breakpoint (768–1279px)

The compacted controls need ~623px of row. Below 960px the site title is a flex
item that yields (`flex-shrink: 1`, ellipsis) so the row never overhangs the
viewport. From 960px the title is the fixed `--vp-sidebar-width` lane and cannot
yield, so the version badge and the Settings gear drop their 8px gaps across the
whole band (not just where it binds, so the arrangement does not jump at 960px).
The slider abbreviates to glyphs-only (active label visually hidden, still
supplying the accessible name) and the search button compacts to its magnifier
icon. Every control keeps its place in the row — the version must stay visible,
and a control a click away is not visible. E2e assertions pin the row fitting
inside 768px, 800px, 960px, and 1000px viewports, each with a positive control
that undoes the rule making room at that width.

### Tri-state theme pickers behind the Settings gear

`ThemePicker.vue` renders two independent tri-state segmented icon toggles:

- **Site theme**: Light / Device / Dark. State runs through VueUse's
  `useColorMode` on VitePress's `vitepress-theme-appearance` localStorage key
  with `emitAuto: true` and `modes: { light: "", dark: "dark" }`, so writes
  propagate to VitePress's own instance in the same tab and to other tabs via
  the storage event. "Device" stores `auto` (follows `prefers-color-scheme`,
  live). VitePress's pre-hydration inline script prevents a flash of the wrong
  theme. The key is mirrored in the component and guarded by a test that fails
  if it drifts from the VitePress client source.
- **Code theme**: Light / Default / Dark, where "Default" means code blocks
  follow the site theme. State and persistence live in `code-theme.ts`.

Both groups live inside a gear-icon disclosure (`SettingsMenu.vue`) at the right
end of the desktop nav row. These are low-frequency settings, and two tri-state
groups (six icon buttons plus a group glyph) crowd the centered search if
inlined. The disclosure is a real `<button>` with `aria-expanded` /
`aria-controls`; Escape closes and returns focus to the trigger, an outside
click closes it, and focus is not trapped. In the panel, `ThemePicker` receives
`group-labels` so each group gets a visible "Site theme" / "Code theme" caption
and the two stack vertically; the decorative code-brackets glyph (which only
disambiguated the rows side by side) is hidden.

The mobile hamburger nav screen mounts `ThemePicker` directly, unlabeled and
side by side — it has full width and no hover affordance, so burying it a second
tap deep would make it worse.

Segments never drop below the WCAG 2.5.8 24px minimum target size; the active
state is exposed via `aria-pressed`, never color alone. A hydration-gating flag
(`mounted`) forces one re-render after hydration so the server's middle-option
default repaints to the real stored choice.

Rejected: a single cycling theme button per group — it hides the available
states and makes the current one ambiguous.

### Page-independent navbar geometry

VitePress keys four geometry rules (`.wrapper` padding, `.container` max-width,
`.title` positioning, `.content` padding) on its own `has-sidebar` class, which
is true for `/api/**` and false for both `/` (`layout: home`) and `/skills`
(`themeConfig.sidebar` is keyed only on `/api/`). That makes the row's left inset
`var(--vp-sidebar-width)` on reference pages and `32px + title width` elsewhere
— a ~97px difference. Because the slider holds the leading slot, that inset
showed up as controls **moving** between page types.

All non-sidebar pages are brought onto VitePress's full-width `has-sidebar`
geometry by mirroring its values under `:not(.has-sidebar)` in `nav-controls.css`,
including the 1440px centered tier (without which the inset diverges again above
1440px). Full width — not the reverse — because the title text then aligns with
the 320px sidebar rail directly beneath it on the generated pages. No
`!important` is needed: `.VPNavBar:not(.has-sidebar) .content` at (0,3,0) beats
the stock scoped `.content` at (0,2,0) but loses to
`.VPNavBar.has-sidebar .content` at (0,4,0), so reference pages keep their stock
rule. The `.title` selector uses a child chain (`> .wrapper > .container >
.title`) because these unscoped rules would otherwise also match the anchor
inside `VPNavBarTitle`.

These geometry rules are **not** gated on the slider's presence — they are page
geometry, not control arrangement, so a single-language build also gets one
shape on every page. The CSS says so in a comment; do not "harmonize" the gating
and reinstate the jump. (The 320px sidebar width this mirrors is set in
[sidebar navigation](./2026-10-15-sidebar-navigation.md).)

The home page's scroll-0 chrome (transparent bar, no divider, hero bleeding
under it) is a hero treatment, not a control position, and is untouched.

### One navbar divider and a steady title color

The bar's rule is drawn by **one element on every page**. On reference pages
VitePress drew it in two mismatched pieces — the title lane's bottom border
ending at the title width and the inset `.divider` beginning at
`--vp-sidebar-width`, resolving different tokens across the gap. Both stock
cosmetic rules are switched off on sidebar pages (`.divider` loses its inset,
the title lane's `border-bottom-color` is cleared) so the single `.divider-line`
spans full width, at both the 960px and 1440px tiers. `!important` is required
here (unlike the geometry rules) because the stock rules are Vue-scoped at
(0,4,0).

The former rule pinning the site title to `--vp-c-text-2` is superseded by
[navbar title lockup](./2026-10-23-navbar-title-lockup.md). The title now uses
the primary text color and responsive complete labels. The nav links keep their
brand-color hover — that remains the theme's navigation affordance.

### Navbar title-lane background

On a sidebar page the home button flashed color shortly after load: three stock
`VPNavBar` rules combine so the title lane paints `--vp-c-bg` opaquely before
hydration, then transitions away over 0.25s to reveal the sidebar's
`--vp-c-bg-alt` behind it. Above 960px the lane is pinned to carry
`--vp-c-bg` so it has a color of its own from the first painted frame and matches
the rest of the bar.

Two details are load-bearing:

- The rule is keyed on **`:not(.home)`**, not `.has-sidebar`. `has-sidebar` is
  added when the client takes over — the exact moment the stock fade begins — so
  a rule keyed on it animates the lane up from transparent while the sidebar
  shows through. The `home` class comes from the route and holds from the first
  frame.
- The lane's own background **transition is dropped** (`transition: none`). A
  client-side navigation off the landing page drops the `home` class, switching
  the declaration on mid-flight; the stock transition would otherwise cross-fade
  the lane up from transparent with the sidebar showing through. The lane is the
  one element whose background must change in step with the route, not over time.

`!important` is required for the same (0,4,0) scoping reason as the divider. The
landing page is untouched (its bar stays transparent over the hero), guarded by
an assertion so the rule cannot be widened onto it. The cost, taken
deliberately: a manual light/dark toggle no longer cross-fades the lane while the
rest of the bar does, so that interaction can show a brief seam — the navigation
flash happens on every visit, the toggle seam only when a reader changes theme.
Because the geometry mirror above keeps a stock `background-color: transparent`
declaration in step with VitePress and its pin compares declarations rather than
painted color, that pin will not catch a divergence in what the lane actually
paints; a reader changing either must know this.

### Controlled scroll animation

A shared, framework-free helper (`smooth-scroll.ts`) animates `scrollTop` with a
`requestAnimationFrame` loop over an ease-out cubic, pinned to
`SCROLL_DURATION_MS = 300` regardless of distance. It replaces
`scrollTo({ behavior: "smooth" })`, whose native animator exposes no duration
knob and (in Blink) scales duration with distance — a jump across the full API
index settled in ~1,500ms, five times the ~0.1–1s responsiveness budget. Under
`prefers-reduced-motion: reduce` the helper sets the position immediately (WCAG
2.3.3: reduced motion means no animation, not no scrolling).

Two affordances use it:

- **Back to top** (`BackToTop.vue`), mounted in `layout-bottom` beside the
  footer, drives `document.documentElement` only. It renders at the theme's
  floating elevation (`z-index: 100`, 40px, 44px below 768px, bottom-right),
  hidden until one viewport of scroll. Before scrolling it moves focus to the
  top-of-document heading (`preventScroll`) so hiding the button does not throw
  keyboard focus to `<body>`.
- The sidebar's "Locate current page" reveal drives its inner scroller only, so
  the two scrollers keep independent positions — owned by
  [sidebar navigation](./2026-10-15-sidebar-navigation.md).

Ease-out cubic (not ease-in-out) so a navigation aid reads as immediate.
Rejected: CSS `scroll-behavior: smooth` — same UA animator, and it would also
capture anchor and search-result jumps that never asked for animation.

## Consequences

- One consistent footer appears on home, versions, and every `/api/**` page;
  the legal line cannot drift between page classes. A VitePress upgrade can
  silently break the sidebar offset — the e2e footer spec and the bump checklist
  are the mitigation.
- Exactly one appearance control is reachable at every breakpoint, and appearance
  is one click away on desktop (the trade for a low-frequency setting). If
  genuinely low-frequency settings appear later they can join the Settings
  dropdown; the theme toggle just should not be what seeds a new one.
- Single-language builds keep the stock control *arrangement* (gated on the
  slider) but not the stock navbar *geometry* — a ts-only home page also renders
  the full-width bar. That is intended: gating the geometry on the slider would
  reinstate the cross-page jump for every multi-language build.
- The search trigger has two no-movement invariants that belong together: it
  must not move when the language changes (the stable-label-width sizers in the
  slider) and must not move when the page changes (the geometry mirror). Both are
  the same defect at different scales; off-center is acceptable, *moving* is the
  bug.
- The e2e suite carries the first cross-page navbar assertion; any future navbar
  work that measures only one page type is, by this record, under-tested. The
  divider assertion is positive geometry (the one line reaches both viewport
  edges on all three page types) so it cannot pass by the line not being drawn.
- The title-lane and transition regressions are browser measurements sampling
  every animation frame and requiring each to be an end state, because a
  stylesheet assertion cannot show the absence of a transition.
- Unit pins read VitePress's and the pagefind plugin's own sources
  declaration-by-declaration rather than hard-coding mirrored values, so an
  upstream geometry or height change fails at the test instead of letting the
  page types silently diverge.
