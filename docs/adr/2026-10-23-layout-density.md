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

- **Levels (ordering fixed here; the numbers land in later steps).** Compact is
  never looser than Balanced and Balanced is never looser than Spacious, in
  every area:
  - Member rows, section headers, tables: Balanced is today's values loosened a
    little (#38); Compact keeps today's values (#37); Spacious is looser than
    Balanced (#37).
  - Outline: Spacious keeps today's values; Balanced is a little tighter and
    smaller in font size; Compact is tighter still (#35).
  - Sidebar: Balanced keeps today's values; Compact is tighter and Spacious
    looser (#37).

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
