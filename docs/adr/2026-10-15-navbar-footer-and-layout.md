# Navbar, Footer, and Site Layout

## Status

Accepted

## Context

The site extends the VitePress 1.6.x default theme rather than forking it. The
navbar carries custom controls (language tabs, the search box, a version
badge, and appearance pickers), the site needs one footer on **every** page
including the tens of thousands of generated `/v2/**` reference pages, and the
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
- WCAG 2.5.5 touch targets (>= 44x44px) below 960px for the hamburger, TOC
  dropdown button, sidebar drawer rows, the breadcrumb favorite star, and every
  control in the top bar, the Settings dropdown (768–959px) and the hamburger
  menu (below 768px): the logo link, the version badge, the search trigger,
  the Settings gear, the language tabs, and the theme and navigation picker
  segments (whose 40px tracks grow with them and whose theme picker wraps
  inside a 320px menu);
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
generated `/v2/**` page. Instead `SiteFooter.vue` mounts in the default theme's
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
mis-aligns silently with no unit-test failure, so check an `/v2/**` page at
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
"Edit this page" link omitted on generated pages that have no editable source. The edit-URL and report-URL logic and the generated-page rule are owned by
[page feedback, consent, and stamp](./2026-10-15-page-feedback-consent-and-stamp.md);
the "Page last updated" date is owned by
[versions and history](./2026-10-15-versions-and-history.md);
the footer holds no Markdown link: the "Copy Markdown" button at the top of the page owns the Markdown actions, as
described in
[SEO and agent discoverability](./2026-10-15-seo-and-agent-discoverability.md).

### Navbar control arrangement

VitePress exposes no slot before the search component, so rather than
re-implement the navbar the custom controls stay mounted in the slots the theme
offers and are repositioned with flex `order` in `nav-controls.css`.
`nav-bar-content-after` renders `[LanguageToggle, VersionBadge, SettingsMenu]`;
`nav-screen-content-after` (the mobile hamburger menu) renders
`[LanguageToggle, ThemePicker, NavStylePicker]`. The navigation style row is
specified in [sidebar navigation styles](./2026-10-23-sidebar-navigation-styles.md).

- **Language tabs lead** (`.language-toggle { order: -2 }`), taking the slot
  the search box used to occupy and the leading gap the search's `padding-left`
  used to provide (now a 10px margin). It is the primary control on a
  multi-language docs site. Its radio-group behavior and labels are owned by
  [multi-language](./2026-10-15-multi-language.md). The options are drawn as
  text tabs on the bar itself, with no track and no fill: muted text when idle,
  a hover fill, and the selected tab in the brand color with a 3px underline
  that sits on the bar's bottom edge, because the group spans the control row's
  full height. The earlier bordered track's edge was under the 3:1 non-text
  contrast minimum, and in light mode its selected fill matched the track, so
  selection relied on the brand color and a 2px inset underline alone.
- **Search is centered** (`.search { order: -1; justify-content: center;
  padding-left: 0 }`), keeping the pagefind plugin's `flex: 1` so it owns the
  region between the tabs and the right-hand controls and centers its trigger
  within it. True viewport-centering is not attempted — it breaks the search
  dropdown's anchoring and collides with controls at narrow widths — and
  centering within the free middle region is visually equivalent at real widths.
  The trigger is an outlined pill: the bar's own background with a 1px edge
  (`--tb-input-border`, 5.6:1 light, 6.9:1 dark against the bar) instead of the
  plugin's near-white fill with a transparent border, which has no visible box
  on a white bar. Hover adds a 1px brand ring; keyboard focus a 2px outline
  2px outside (inset 2px on the bare phone icon below 768px, which is the
  bar's full height, so the ring stays in the viewport). The `Ctrl K` chip
  takes the same edge.
- **Version badge then Settings gear** sit at the right end, in the same muted
  ink as the idle tabs and the search label (`--tb-muted`, 9.4:1 light, 10:1
  dark) with the same hover fill (`--tb-hover-bg`) and hover text
  (`--tb-hover-fg`: the primary text in light mode; `#ebebf0` in dark mode,
  10.7:1 on the fill, because the dark idle ink already is the primary text).
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
(where the tabs do not render) keeps the completely stock control
arrangement. Browsers without `:has()` degrade gracefully: the tabs still
render and keep their leading position (their rule is not gated), only the
search's centering falls back to the theme's default position.

The search trigger, version badge and Settings trigger are pinned to the same
40px rendered height from 960px up. The pagefind plugin hard-codes `height:
40px` on `.nav-search-btn-wait` and exposes no variable, so the value is restated
as a literal in `SettingsMenu.vue` and in the version badge rule in
`nav-controls.css`, and `test/nav-controls.test.ts` and `test/version-badge.test.ts`
pin both to 40px. The language tabs are the exception: they stretch to the
control row's full height so their underline meets the bar's edge. A transparent
3px top border balances the underline, so each label's midpoint sits on the same
line as the 40px controls.

#### Fitting the medium breakpoint (768–1279px)

The compacted controls fill most of the row (the e2e row-fit widths below pin
that they fit). Below 960px the site title is a flex
item that yields (`flex-shrink: 1`, ellipsis) so the row never overhangs the
viewport. From 960px the title is the fixed `--vp-sidebar-width` lane and cannot
yield, so the version badge and the Settings gear drop their 8px gaps across the
whole band (not just where it binds, so the arrangement does not jump at 960px).
The tabs keep every language's name visible; only TypeScript shortens, to
`TS` below 1100px (the full name stays in the accessible name). The width comes
out of padding, stepped per band through one variable (`--tab-pad`): 14px side
padding on the tabs from 1280px, 10px below it, and 8px in the 960–1023px band,
where the tabs' 44px minimum width also yields and the nav links tighten from
12px to 8px (below 1100px) and 6px (960–1023px). 768–959px reuses the 1024–1099px
values because the logo-only title gives that band its room. In a multi-language
build the search button compacts to its magnifier icon from 1279px down, inside
a 44px disc at 768–959px; below 768px it is the plugin's bare 48px icon on every
build, with the pill's edge, fill and hover ring dropped. A single-language build
keeps the labeled button.
Every control keeps its place in the row — the version must stay visible, and a
control a click away is not visible. E2e assertions pin the row fitting inside
768px, 800px, 900px, 960px, 1024px, 1099px, 1100px, and 1279px viewports,
and the page scroll width equaling the viewport with no two bar controls
overlapping at 1440, 1359, 1280, 1180, 1100, 1099, 1024, 960, 959, 900, 768,
767, 375 and 320px in both color schemes; the 768px case has a positive control
that widens the title and expects the row to overflow.

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
tap deep would make it worse. For the same reason it mounts `NavStylePicker`
directly as the row after it, keeping its visible `Navigation` caption, because
its text segments alone do not name what they group.

Segments never drop below the WCAG 2.5.8 24px minimum target size; the active
state is exposed via `aria-pressed`, never color alone. A hydration-gating flag
(`mounted`) forces one re-render after hydration so the server's middle-option
default repaints to the real stored choice.

Rejected: a single cycling theme button per group — it hides the available
states and makes the current one ambiguous.

### Page-independent navbar geometry

VitePress keys four geometry rules (`.wrapper` padding, `.container` max-width,
`.title` positioning, `.content` padding) on its own `has-sidebar` class, which
is true for `/v2/**` and false for both `/` (`layout: home`) and `/skills`
(`themeConfig.sidebar` is keyed only on `/v2/`). That makes the row's left inset
`var(--vp-sidebar-width)` on reference pages and `32px + title width` elsewhere
— a ~97px difference. Because the tabs hold the leading slot, that inset
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

These geometry rules are **not** gated on the tabs' presence — they are page
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

### Wide-screen tier

The default theme stops growing at its 1440px tier: `--vp-layout-max-width` is
1440px, a page without a sidebar caps its doc container at 1104px and its
content at 784px, and the column beside the outline (`.content-container`) caps
at 688px on every page. Above 1440px nothing grows, so a 2560px monitor shows
the docs in a narrow column with empty space on both sides.

One more tier, `@media (min-width: 1920px)` in
`docs/.vitepress/theme/wide-layout.css`, raises `--vp-layout-max-width` to
1920px, the no-sidebar container cap to 1440px and the content column cap to
992px; the no-sidebar `.content` cap becomes 1056px (992px plus its own 2 x 32px
padding) so the column it holds can reach 992px. Inside the tier, running prose
(the `p`, `ul`, `ol` and `blockquote` children of the page body) is capped at
784px, a little over the 688px it has beside the outline and the 720px it has
on a no-sidebar page at the 1440px tier; tables, signatures, code blocks and
docgen member rows use the full column, including the remarks prose inside a
member row, which stays at the row's width so a row reads as one unit. One more
breakpoint rather than a full-width layout or a settings option: a fixed tier
keeps prose line length near its current value and the sidebar width constant,
and adds no control to the Settings menu for a layout most readers never see.
The tier starts at 1920px because that is the first width at which a 1920px
layout fits with no centering offset, so the wide tier begins exactly where its
layout fits. Breakpoints are in CSS pixels, so the tier depends on display
scaling: a 2560px monitor reaches it at 100% or 125% (2048 CSS px) but not at
150% (1707 CSS px), and a 1920px monitor reaches it only at 100%. Every cap is a
stock width or derived from one: 1440px is the stock layout max, 992px the stock
no-sidebar container at 960px, 784px the stock no-sidebar content at 1440px, and
1056px is 992px plus the column's own padding.

The sidebar keeps `--vp-sidebar-width` (320px) and the outline its 256px. Every
rule that centers on the layout width — the stock `VPContent`, `VPSidebar`,
`VPNavBar` and `VPLocalNav` 1440px tiers, the nav mirror above and the footer
offset — reads `var(--vp-layout-max-width)`, so raising the variable **is**
their 1920px tier. They are deliberately not duplicated into the new tier: the
nav mirror is pinned to the stock tiers by `test/nav-controls.test.ts`, and a
second copy of the footer math would be one more place to drift. The three width
caps carry `!important` for the same reason the divider rules do: the stock
declarations are component-scoped at (0,4,0).

The same stylesheet places `/versions` in the lane right of the sidebar. The
page has no sidebar, so the stock theme centered its container in the full
viewport while the nav bar above it carries the sidebar-lane inset from the
geometry section, so the page read as off-center. `/versions` is aligned first
because the offset is most visible there: its one wide table sits directly
under the inset nav controls with nothing else on the page. The other no-sidebar
pages (`/skills`, also linked from the nav bar, and `/stability`) keep the
stock full-viewport centering until they are
aligned as a group by widening the `.Layout.versions-page` selector; nothing
about them makes the stock centering wrong, so that is a separate decision. The
sheet mirrors
`VPContent.has-sidebar`'s padding onto the page's content and `SiteFooter`'s
`has-sidebar` offset onto its footer, from the
tightest desktop tier (1280px) and in the 1440px tier, so content, nav and
footer share one lane there too. Between 960 and 1279px, where a zoomed-in large
monitor lands (1920px at 200% is 960 CSS px), the page keeps its full
viewport-centered width: the alignment would cost a third of it. The hook is `pageClass: versions-page` in the page's frontmatter, which
VitePress puts on the `.Layout` root, an ancestor of both the content and the
footer; `test/wide-layout.test.ts` pins the frontmatter, the `Layout.vue`
binding and the mirrored declarations against the installed sources.

`test/e2e/wide-layout.spec.ts` measures the result at 960, 1280, 1440, 1920 and
2560px: the column grows from 688px to 992px, prose stays at or under 784px,
member-row remarks are uncapped, the content, nav and footer start on one lane,
below 1920px every width on the sidebar pages is the stock one, `/versions`
content and footer sit within 2px of the sidebar pages' lane from 1280px with no
scroll inside the versions table or on the document, and at 960px `/versions`
keeps its stock 896px container.
`test/e2e/nav-controls.spec.ts` runs its page-independence check at 1920 and
2560px as well.

## Consequences

- One consistent footer appears on home, versions, and every `/v2/**` page;
  the legal line cannot drift between page classes. A VitePress upgrade can
  silently break the sidebar offset — the e2e footer spec and the bump checklist
  are the mitigation.
- Exactly one appearance control is reachable at every breakpoint, and appearance
  is one click away on desktop (the trade for a low-frequency setting). If
  genuinely low-frequency settings appear later they can join the Settings
  dropdown; the theme toggle just should not be what seeds a new one.
- Single-language builds keep the stock control *arrangement* (gated on the
  tabs) but not the stock navbar *geometry* — a ts-only home page also renders
  the full-width bar. That is intended: gating the geometry on the tabs would
  reinstate the cross-page jump for every multi-language build.
- The search trigger has two no-movement invariants that belong together: it
  must not move when the language changes (every option paints its own name in
  the same typesetting, checked or not) and must not move when the page changes (the geometry mirror). Both are
  the same defect at different scales; off-center is acceptable, *moving* is the
  bug.
- The e2e suite carries the first cross-page navbar assertion; any future navbar
  work that measures only one page type is, by this record, under-tested. The
  divider assertion is positive geometry (the one line reaches both viewport
  edges on all three page types) so it cannot pass by the line not being drawn.
- The title-lane and transition regressions are browser measurements sampling
  every animation frame and requiring each to be an end state, because a
  stylesheet assertion cannot show the absence of a transition.
- Unit pins read VitePress's own sources declaration-by-declaration rather
  than hard-coding mirrored values, so an upstream geometry change fails at the
  test instead of letting the page types silently diverge. The pagefind
  plugin's 40px trigger height has no source contract to read, so it is
  restated as a literal and pinned in `test/nav-controls.test.ts` and
  `test/version-badge.test.ts`; a plugin height change shows up in the e2e row
  and baseline checks instead.
- `/versions` trades width for alignment from 1280px up: its container is 896px
  at 1280px and 1056px at 1440px, against the stock 992px and 1104px; below
  1280px it keeps the stock width and the nav-lane misalignment.
- Above 1920px the layout is 1920px wide and the content column 992px; a
  VitePress bump that moves the 1440px tier or its three caps fails
  `test/wide-layout.test.ts`, which reads them from the installed sources. Any
  rule that ever hard-codes 1440px instead of reading `--vp-layout-max-width`
  will drift at 1920px; the e2e lane assertions are the mitigation.
