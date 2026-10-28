# Layout Density: Spacing Tokens and a Stored Density Setting

## Status

Accepted

## Context

Spacing and small font sizes across the generated API layout — member rows,
the Properties/Methods section headers, the aside outline, the API sidebar, and
doc-body tables — are hard-coded as literals spread across several theme
stylesheets. There is no single place to vary density and no way to remember a
reader's choice.

A later step will give readers a layout-density choice (Compact, Balanced,
Spacious). This record covers only the foundation that choice needs: a spacing
token layer and a stored density setting, both wired so the default renders
exactly as the site does today. It changes nothing a reader can see.

The choices below (token prefix, storage key, attribute, value set, the
bootstrap as the single source of truth for first paint, the per-area level
ordering, and what is deliberately left untokenized) were settled with the
maintainer before the work started.

## Decision

- **Token layer.** Spacing and small font sizes for the tokenized areas are
  expressed as `--density-*` CSS custom properties, declared once on `:root` in
  `docs/.vitepress/theme/density.css` at today's values. Each tokenized rule
  reads `var(--density-*)` instead of a literal. The tokens cover:
  - Member rows (`api-layout.css`): vertical padding, divider width, header
    part gap, fold-out padding.
  - Aside outline (`outline.css`, `ApiDocAsideOutline.vue`): entry font size,
    line height, entry padding, member indent.
  - API sidebar (`api-sidebar.css`): item font size, line height, item
    padding, nesting indent.
  - Doc-body tables (`density.css`): cell padding, block margin.
  - The Properties / Methods / Construct Props section headers
    (`api-layout.css`): header font size.

- **State and storage.** `docs/.vitepress/theme/density.ts`, modeled on
  `code-theme.ts`, owns a `Density` type (`compact | balanced | spacious`), a
  shared `ref`, the localStorage key `cdk-docs-density`, and an `apply` function
  that sets `data-density="compact"` or `"spacious"` on the `<html>` element and
  **removes** the attribute for `balanced`. Unknown stored values fall back to
  `balanced`. `balanced` is therefore the absence of any override: the bare
  `:root` tokens apply, so it cannot drift from today's values.

- **Bootstrap is the single source of truth for first paint.** A pre-hydration
  inline script in `docs/.vitepress/config.mts`, mirroring the code-theme
  bootstrap, re-applies a stored non-default choice before first paint so a
  reload never flashes the wrong density. It duplicates only the key and the
  apply rule from `density.ts`, and like the module it applies `compact` /
  `spacious` only (an unknown or `balanced` value leaves no attribute). On the
  server there is no attribute, which is the balanced render.

- **Preset seams.** Empty `[data-density="compact"]` and
  `[data-density="spacious"]` blocks sit next to the `:root` tokens in
  `density.css` for the later step to fill. This step adds no preset values.

- **Levels (ordering fixed here; the concrete numbers land in later steps).**
  Compact is never looser than Balanced and Balanced is never looser than
  Spacious, in every area:
  - Member rows and tables: Compact is tighter than Balanced in type and
    spacing; Spacious is looser than Balanced in spacing, at Balanced type
    sizes, and opens every fold-out.
  - Section headers: the font keeps its per-level values (Spacious a step
    larger); the margins are the same at every level.
  - Outline: Spacious keeps today's values; Balanced is a little tighter and
    smaller in font size; Compact is tighter still.
  - Sidebar: Balanced is today's values loosened a little; Compact is tighter
    and Spacious looser.

- **Balanced values.** The foundation shipped the tokens at the then-current
  values; the Balanced loosening step raised them a little so the default reads
  more openly, keeping room below for Compact (today's values) and above for
  Spacious:
  - Member rows: vertical padding `12px` (was `10px`), divider `1px`
    (unchanged, already the stronger `--vp-c-border`).
  - Section headers: `40px` above / `16px` below, so a section reads as
    starting a new block; font size `1.4rem` unchanged.
  - Sidebar: item vertical padding `6px` (was `5px`); font, line height and
    indent unchanged.
  - Doc-body tables: cell padding `6px 12px` (was `5px 10px`), block margin
    `16px` (was `14px`) — still tighter than the stock theme's `8px 16px` /
    `20px`.
  - Outline: unchanged here. The outline values are owned by their own step.

- **Deliberately not tokenized.** Body prose outside member rows, code blocks
  and the navbar keep their own type sizes untouched: tokenizing the reading
  column's text size would let a density preset shrink prose, which is out of
  scope. Member-row text sizes are density tokens (`--density-member-name-font`,
  `--density-member-type-font`, `--density-member-prose-font`), because how
  much of a type's members a reader sees at once is what density is for.

## Consequences

- There is one place to vary density, and a reader's choice has a home, without
  changing anything a reader sees today: at Balanced every tokenized property
  renders exactly as on `main`.
- `test/density.test.ts` moves its pinned literals into the tokens and reads the
  token values from `:root`, so the thresholds it guards still hold.
- `test/density-state.test.ts` covers the state module: default, a stored value,
  an unknown value, and apply/remove of the attribute, plus the bootstrap key.
- An end-to-end test asserts that a stored `compact` choice sets `data-density`
  before first paint, and a built-output check asserts the bootstrap script is
  present and the tokens are declared once.
- The later density-picker UI and the Compact/Spacious preset values build on
  this layer without re-opening these choices.

## Addendum: the Layout picker and the Compact / Spacious presets

Added with the density picker step. The decisions above stand.

- **Picker.** A third tri-state group, **Layout**, sits in `ThemePicker.vue`
  after Site theme and Code theme, so it shows in the Settings menu (with its
  visible caption) and in the mobile nav screen. It offers Compact, Balanced
  and Spacious, in that order, with the same segmented icon buttons, accessible
  names (`Compact layout`, `Balanced layout`, `Spacious layout`), `aria-pressed`
  state and 24px minimum targets as the other two groups. A click calls
  `setDensity`, which applies and stores the choice at once.
- **Preset values.** A token a preset leaves out falls back to `:root`
  (Balanced). The table is the current set, after the Balanced loosening and
  the member-row type step.

  | Token | Compact | Balanced (`:root`) | Spacious |
  |---|---|---|---|
  | `member-name-font` | 0.875rem | 0.9375rem | 0.9375rem |
  | `member-type-font` | 0.8125rem | 0.875rem | 0.875rem |
  | `member-prose-font` | 0.8125rem | 0.875rem | 0.875rem |
  | `member-row-pad-y` | 12px | 13px | 16px |
  | `member-divider` | 1px | 2px | 2px |
  | `member-gap` | 12px | 14px | 16px |
  | `member-foldout-pad` | 4px | 6px | 8px |
  | `section-header-font` | 1.4rem | 1.4rem | 1.5rem |
  | `section-header-margin-top` / `-bottom` | 40px / 16px | 40px / 16px | 40px / 16px |
  | `table-cell-pad-y` / `-x` | 6px / 12px | 7px / 12px | 8px / 16px |
  | `table-margin` | 16px | 18px | 20px |
  | `sidebar-font` | 13px | 14px | 14px |
  | `sidebar-line` | 1.4 | 1.5 | 1.6 |
  | `sidebar-pad-y` | 3px | 6px | 8px |
  | `sidebar-indent` | 12px | 14px | 16px |
  | `outline-font` | 12px | 13px | 14px |
  | `outline-line` | 1.2 | 1.25 | 1.3 |
  | `outline-pad` | 2px | 4px | 5px |
  | `outline-indent` | 16px | 16px | 16px |

- **Member-row type.** Every prose line in a row (summary, inline default,
  extra prose, folded-out details, the disclosure label) reads
  `--density-member-prose-font`, so a row shows one prose size; a quote or a
  custom block inside a row inherits it instead of the default theme's 16px or
  fixed 14px. The header line (name, optional mark, inline signature) reads
  `--density-member-name-font` and the type `--density-member-type-font`, which
  is never larger than the name. Compact's spacing is the values Balanced had
  before this step. Spacious stays at Balanced type sizes and only adds room;
  its table cells return to the stock `8px 16px` and `20px` margin. Badges,
  anchors, row order, body prose outside rows, code blocks, the navbar, and the
  inheritance bar and metadata block keep their sizes.
- **Spacious opens every fold-out.** At Spacious every
  `details.member-disclosure` and `details.chain-more` in the page content is
  open; at Balanced and Compact they are closed. A script sets the real `open`
  attribute rather than a CSS rule revealing the content, so assistive
  technology hears the true expanded state and a reader can still close one
  (mouse, or Enter / Space on its summary). Per fold-out state is not stored:
  the level's default returns on the next level switch, navigation or reload.
  The bootstrap in `config.mts` stays the single source of first paint: with a
  stored `spacious` it opens each fold-out as the parser inserts it (a
  MutationObserver, whose callbacks run before the next paint) and stops at
  `DOMContentLoaded`. `theme/density.ts` applies the same rule on a level
  switch, once after hydration, and after each client-side route change. The
  inheritance bar's clamp (ADR 2026-10-15-api-reference-pages) therefore stays
  closed at Compact and Balanced and opens at Spacious.
- **Cost on the largest page.** An open fold-out is styled and laid out, and
  `constructs.Construct` holds about 2,700 inheritance names. VueUse's
  appearance handler (VitePress's `useDark` and the Site theme picker's
  `useColorMode`) adds a global `transition: none` sheet and forces a
  whole-page style recalc each time it applies, including on mount when the
  pre-paint script has already set the class; four such recalcs over the open
  list made a ~255ms long task. Both instances now pass an `onChanged` that
  applies only when the `dark` class actually changes, so a real toggle still
  disables transitions. The page's longest task at Spacious drops to ~120ms
  (Balanced ~100ms) and scrolling it end to end raises none.
- **Outline levels.** Spacious preserves the pre-density outline exactly:
  14px text, 1.3 line height, 5px vertical padding, and a 16px content indent.
  Balanced uses 13px text, 1.25 line height and 4px padding. Compact uses 12px
  text, 1.2 line height and 2px padding. All levels keep the 16px indent so
  wrapping width and hierarchy stay stable; only type and vertical spacing
  change. `ApiDocOutlineItem.vue` reads the font token directly, and the active
  marker measures its link instead of relying on one fixed row height.
- **Sidebar targets.** A Compact sidebar item is 13px x 1.4 + 2 x 3px = 24.2px
  tall, so it stays a 24px target.
- `test/density.test.ts` checks the level order for every token, the areas
  each preset must leave alone, and the Compact sidebar target height.
  `test/e2e/density-picker.spec.ts` checks the picker's place, order, storage,
  reload, keyboard use, the mobile nav screen, the rendered heights per level,
  and that body prose, code blocks and the navbar do not change.
  `test/e2e/outline-density.spec.ts` pins each level's computed font, line
  height and padding, checks long names do not clip, and keeps the active marker
  centered as row heights change.
