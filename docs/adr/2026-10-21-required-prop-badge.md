# Required Property Marker as a Distinct Badge

## Status

Accepted

## Context

Generated API reference pages render each property in a type's props table with
its required or optional state. The required state was emitted as a
`<span class="member-required">required</span>` element, but styled as muted
italic body text the same weight and color as the surrounding cell
(`color: var(--vp-c-text-2)`, `font-style: italic`, `0.75rem`). A reader
skimming a long props table — for example a `Props` interface with dozens of
properties — could not tell at a glance which properties are mandatory, because
the required word did not stand out from the prose around it.

An earlier iteration had used an amber badge and then replaced it with muted
text, on the grounds that the badge "outweighed the member name beside it".
That reasoning optimized for the identifier over the required signal, but the
required signal is precisely what a reader scanning for "what must I supply"
needs to find first. Issue #20 asks to reverse that: make the
required state a visually distinct styled marker, not plain inline text, while
leaving which properties are required unchanged.

## Decision

The required marker renders as a distinct badge. The marker stays
`<span class="member-required">required</span>`, and the `.member-required`
rule in `docs/.vitepress/theme/api-layout.css` styles it as a filled pill: the
amber `--api-c-badge-bg` / `--api-c-badge-text` token pair (the palette the
kind chip `.type-tooltip-kind` already uses), uppercase, weight 600, rounded
corners, small padding. Those tokens are declared for both light and dark mode
at the top of the stylesheet, so the badge stays legible in both themes and
meets the normal contrast expectations the a11y gate checks.

The marker is present in the built markup — the `member-required` span is
emitted unconditionally for a non-optional property when the page is generated,
not injected on the client — so it renders with no JavaScript.

The `static` modifier keeps its muted italic styling: it is a minor modifier,
not the must-supply-this signal, and should not compete with the required badge
for the reader's eye. Which properties are marked required is unchanged; only
the presentation of the existing required state changes. Optional properties
carry no required marker, so they remain clearly distinguishable.

## Consequences

- Required properties are obvious at a glance when scanning a props table.
- The required chip and the kind chip read from the same `--api-c-badge-*`
  palette token, so a future retint stays consistent across them; the leveled
  kind chips override the token with their own level palette and are
  unaffected.
- `test/api-layout.test.ts` asserts on the produced output that a required
  property renders the `member-required` marker and the `.member-required` rule
  styles it as a filled pill (background + rounded corners, no italic), and
  that an optional property renders no `member-required` marker.
