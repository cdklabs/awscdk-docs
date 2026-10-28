# Layout Density: Spacing Tokens and a Stored Density Setting

## Status

Accepted

## Context

Spacing and small font sizes across the generated API layout — member rows,
the Properties/Methods section headers, the aside outline, the API sidebar, and
doc-body tables — are hard-coded as literals spread across several theme
stylesheets. There is no single place to vary density and no way to remember a
reader's choice.

A later step will give readers a layout-density choice (Spacious, Balanced,
Compact). This record covers only the foundation that choice needs: a spacing
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
  - Member rows, section headers, tables: Balanced is today's values loosened a
    little; Compact keeps today's values; Spacious is looser than Balanced.
  - Outline: Spacious keeps today's values; Balanced takes today's Balanced
    outline spacing at the sidebar font (14px); Compact is one font step (14px
    to 13px) smaller and tighter still.
  - Sidebar: Balanced takes today's Compact sidebar spacing (1.4 line, 3px
    padding) at the 14px font with a 12px indent; Compact is one font step
    (14px to 13px) and one indent step (12px to 10px) tighter; Spacious is
    looser.

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

- **Deliberately not tokenized.** Body prose, code blocks and the navbar keep
  their own type sizes untouched. Density is about the generated API layout's
  spacing and its own small labels, not the reading column: tokenizing body
  text size would let a density preset shrink prose, which is out of scope.

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
  visible caption) and in the mobile nav screen. It offers Spacious, Balanced
  and Compact, in that order, so the row reads as a scale from loosest to
  tightest, with the same segmented icon buttons, accessible names
  (`Spacious layout`, `Balanced layout`, `Compact layout`), `aria-pressed`
  state and 24px minimum targets as the other two groups. A click calls
  `setDensity`, which applies and stores the choice at once.
- **Preset values.** Only the tokens a preset owns are set. A token a preset
  leaves out falls back to `:root` (Balanced). The table lists the real token
  values; the nav and outline rows were retuned in the information-density
  step for the nav and outline, the rest in the Balanced loosening step.

  | Token | Compact | Balanced (`:root`) | Spacious |
  |---|---|---|---|
  | `member-row-pad-y` | 12px | 12px | 13px |
  | `member-divider` | 1px | 1px | 2px |
  | `member-gap` | 12px | 12px | 14px |
  | `member-foldout-pad` | 4px | 4px | 6px |
  | `section-header-font` | 1.4rem | 1.4rem | 1.5rem |
  | `table-cell-pad-y` / `-x` | 6px / 12px | 6px / 12px | 7px / 12px |
  | `table-margin` | 16px | 16px | 18px |
  | `sidebar-font` | 13px | 14px | 14px |
  | `sidebar-line` | 1.4 | 1.4 | 1.6 |
  | `sidebar-pad-y` | 3px | 3px | 8px |
  | `sidebar-pad-x` | 4px | 4px | 4px |
  | `sidebar-indent` | 10px | 12px | 16px |
  | `outline-font` | 13px | 14px | 14px |
  | `outline-line` | 1.2 | 1.25 | 1.3 |
  | `outline-pad` | 2px | 4px | 5px |
  | `outline-indent` | 16px | 16px | 16px |

- **Why Compact rows match Balanced for now.** Per the levels above, Compact
  keeps today's member rows, headers and tables, and Balanced is loosened in
  its own step. Until that step lands, the two are equal in those areas.
- **Outline levels.** Spacious preserves the pre-density outline exactly:
  14px text, 1.3 line height, 5px vertical padding, and a 16px content indent.
  Balanced uses 14px text, 1.25 line height and 4px padding (25.5px entries).
  Compact uses 13px text, 1.2 line height and 2px padding, held at the
  existing 24px minimum height. At every level the outline font equals the
  sidebar link font. All levels keep the 16px indent so wrapping width and
  hierarchy stay stable; only type and vertical spacing change.
  `ApiDocOutlineItem.vue` reads the font token directly, and the active
  marker measures its link instead of relying on one fixed row height.
- **Sidebar targets.** A Balanced sidebar item is 14px x 1.4 + 2 x 3px =
  25.6px tall and a Compact one 13px x 1.4 + 2 x 3px = 24.2px, the only 13px
  combination above the 24px target floor (1.35 would give 23.55px), so
  Compact keeps Balanced's line and padding and its extra tightness comes from
  the font step and the 10px indent. Spacious items are 14px x 1.6 + 2 x 8px =
  38.4px. The caret and the construct level tag size their boxes from the
  sidebar font and line tokens (`calc(1em * var(--density-sidebar-line))` and
  `calc(var(--density-sidebar-font) * var(--density-sidebar-line))`), so group
  rows are never taller than link rows and the tag stays centered on the
  name's first line at each level.
- `test/density.test.ts` checks the level order for every token, the areas
  each preset must leave alone, the 24px sidebar target height at every level,
  and that the outline font equals the sidebar font per level.
  `test/e2e/density-picker.spec.ts` checks the picker's place, order, storage,
  reload, keyboard use, the mobile nav screen, the rendered heights per level,
  and that body prose, code blocks and the navbar do not change.
  `test/e2e/outline-density.spec.ts` pins each level's computed font, line
  height and padding, checks long names do not clip, and keeps the active marker
  centered as row heights change.
