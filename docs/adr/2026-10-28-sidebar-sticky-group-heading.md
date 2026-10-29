# Pinned Group Heading in the API Sidebar

## Status

Accepted

## Context

Deep inside a long sidebar group the reader sees only a column of short entry
names. A resource's Others group can hold hundreds of entries, and once its
enclosing service or package heading has scrolled away nothing on screen says
which one the list belongs to. Only the `.sidebar-header` block (filter,
Locate current page, Favorites) is pinned today
(`2026-10-15-sidebar-navigation.md`, "Sticky sidebar header").

## Decision

- **Eligible headings.** A heading can pin when it is a collapsible group
  heading (`.api-sidebar-group`) that is not a kind group (no
  `data-kind-group`). Kind groups (Constructs, Mixins, Facades, Traits, Others)
  and fixed section titles never pin, in either navigation style: in the
  package style the deepest section title is a category such as CloudFormation
  Property Types, which does not say which package the reader is in.
- **The real button, made sticky.** Eligible headings are `position: sticky`
  at `top: var(--api-sidebar-sticky-top)` with the opaque
  `--vp-sidebar-bg-color` background and square corners. It is the group's own
  button, never a copy, so there is one tab stop, one accessible name, and the
  caret, `aria-expanded` and keyboard behavior are unchanged. The group's `<li>`
  is the containing block, so the browser pushes the heading up as the group
  ends and the next heading takes over; it never overlaps the next row.
- **Offset follows the header.** `--api-sidebar-sticky-top` is set on the
  scroll container to the measured height of `.sidebar-header`, refreshed from
  a `ResizeObserver` on the header (Favorites expanding or collapsing) and on
  the container. Pinned headings use `z-index: 1`, under the header block's
  `z-index: 2` and above every scrolling row, including a row's rotated
  caret, whose `transform` makes it a stacking context at level 0.
- **Deepest only.** Nested eligible headings pin at the same offset and a
  deeper one, later in the DOM, paints above its ancestors. Because an ancestor whose name wraps
  to more lines would still show below it, the ancestors are hidden while a
  deeper heading is pinned (`data-sticky-covered`: transparent, no pointer
  events, still focusable and shown again while it holds keyboard focus).
  `sidebar-sticky.ts` decides this from two `IntersectionObserver`s only, with
  no scroll listener and no per-frame layout reads: a group counts as pinned
  while its `<li>` crosses the line under the header and its heading is still
  entirely below that line. A heading that has started to be pushed away no
  longer counts, so its ancestor shows again behind it rather than leaving a
  gap.
- **Occlusion.** The pinned heading covers rows the same way the header block
  does (WCAG 2.4.11). `scrollPaddingTop` is the header height plus the pinned
  heading's height, so keyboard focus scrolling clears both. The reveal used by
  Locate current page and the on-load reveal insets the visible region by the
  header and by the height of the active entry's nearest enclosing eligible
  heading, which is the one pinned once the entry is in view. A focused pinned
  heading draws its focus ring inside its box, since the header block paints
  over anything above the pinned band.
- **Collapsing from the pinned state.** Clicking a pinned heading (or Enter or
  Space) collapses the group like any other click, then scrolls so the
  collapsed heading row sits directly below the header block, rather than
  leaving the reader at an unrelated position.
- Applies to both navigation styles, the desktop rail and the mobile drawer,
  every density, and while the nav filter is active.

## Consequences

- Only one heading is ever pinned, which keeps the band one heading tall in a
  short sidebar; a breadcrumb stack of ancestors is not offered.
- The tracker observes only groups that are rendered, which the lazy tree
  already limits to open branches, so its cost follows what is on screen.
- An ancestor hidden behind the pinned heading stays in the tab order;
  reaching it by keyboard shows it above the pinned heading.
