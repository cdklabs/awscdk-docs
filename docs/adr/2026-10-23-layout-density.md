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
  - Member rows, section headers, tables: Balanced is today's values loosened a
    little; Compact keeps today's values; Spacious is looser than Balanced.
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
  visible caption) and in the mobile nav screen. It offers Compact, Balanced
  and Spacious, in that order, with the same segmented icon buttons, accessible
  names (`Compact layout`, `Balanced layout`, `Spacious layout`), `aria-pressed`
  state and 24px minimum targets as the other two groups. A click calls
  `setDensity`, which applies and stores the choice at once.
- **Preset values.** Only the tokens this step owns are set. A token a preset
  leaves out falls back to `:root` (Balanced, today's values).

  | Token | Compact | Balanced (`:root`) | Spacious |
  |---|---|---|---|
  | `member-row-pad-y` | 10px | 10px | 13px |
  | `member-divider` | 1px | 1px | 2px |
  | `member-gap` | 12px | 12px | 14px |
  | `member-foldout-pad` | 4px | 4px | 6px |
  | `section-header-font` | 1.4rem | 1.4rem | 1.5rem |
  | `table-cell-pad-y` / `-x` | 5px / 10px | 5px / 10px | 7px / 12px |
  | `table-margin` | 14px | 14px | 18px |
  | `sidebar-font` | 13px | 14px | 14px |
  | `sidebar-line` | 1.4 | 1.5 | 1.6 |
  | `sidebar-pad-y` | 3px | 5px | 8px |
  | `sidebar-indent` | 12px | 14px | 16px |
  | `outline-*` | today's | today's | today's |

- **Why Compact rows match Balanced for now.** Per the levels above, Compact
  keeps today's member rows, headers and tables, and Balanced is loosened in
  its own step. Until that step lands, the two are equal in those areas. The
  outline's tighter Balanced and Compact values are also set in their own step;
  Spacious keeps today's outline.
- **Sidebar targets.** A Compact sidebar item is 13px x 1.4 + 2 x 3px = 24.2px
  tall, so it stays a 24px target.
- `test/density.test.ts` checks the level order for every token, the areas
  each preset must leave alone, and the Compact sidebar target height.
  `test/e2e/density-picker.spec.ts` checks the picker's place, order, storage,
  reload, keyboard use, the mobile nav screen, the rendered heights per level,
  and that body prose, code blocks and the navbar do not change.
