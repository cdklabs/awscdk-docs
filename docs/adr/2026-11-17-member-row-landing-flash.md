# Member Row Landing Flash

## Status

Accepted

Extends [API reference pages](./2026-10-15-api-reference-pages.md), whose member
rows this record marks on landing, and
[members in the type-page outline](./2026-10-22-outline-members.md), whose
entries are one of the jumps it marks. Both stand.

## Context

A reader who jumps to a property or method, from the outline, a member
permalink, a link in prose, a shared deep link or the browser's back and forward
buttons, lands on a row that is scrolled into view but not marked. The page's
only landing style is `.member-row:target`, and the browser sets `:target` on a
page load with a hash alone. VitePress handles every other jump itself: an
in-page link goes through `history.pushState` and its own scroll (it also
dispatches a synthetic `hashchange`), back and forward go through its `popstate`
handler, which reloads the route and ends in `onAfterRouteChange`. None of these
move `:target`, so a reader has to look for the row.

The mark has to work with motion, under `prefers-reduced-motion: reduce`, and
under `forced-colors: active`; it must keep every text color a row carries at
WCAG AA; and it must change nothing about the row's box, focus or accessible
name.

## Decision

A theme module, `member-flash.ts`, puts one class, `member-row-flash`, on the
row a hash names and clears it from any other row. The stylesheet draws the
mark. The `:target` tint is scoped to `html:not(.member-flash-ready)`, which the
module sets on install, so it serves the no-JS and pre-hydration case only;
otherwise the first-loaded row would keep its tint beside every later landing.

**Which handler owns which jump.** The module listens to `hashchange` and a
bubbling `click`, and the theme calls its handler once the first page has
mounted and after each route change.

- An in-page link (outline, permalink, prose): VitePress's synthetic
  `hashchange`, which is not trusted. The same click also reaches the click
  listener, which runs after VitePress's capture-phase handler.
- A repeat click on the hash the page is already at: the click listener alone,
  because VitePress sends no `hashchange` for an unchanged hash.
- A page load with a hash: the route hook, which VitePress runs before mount in
  a build (the mount call covers the dev server, where the rows render later).
- A cross-page link that lands on a member: the route hook, after the new page
  has rendered (the theme awaits `nextTick()` first).
- Back and forward: the route hook. The native `hashchange` fires first, before
  VitePress's `popstate` handler has reloaded the route, so it is left alone.
  It is recognized by `leaveToRouteHook(isTrusted, history.state)`: a trusted
  event whose entry carries the state VitePress's router wrote (`replaceState`
  at boot, `pushState` per link). A hash set by script has no state and is
  flashed from the `hashchange`.

This split relies on VitePress 1.x router behavior that is not documented: the
synthetic `hashchange`, the state it writes, and `popstate` ending in
`onAfterRouteChange`. The e2e cases that count exactly one `animationstart` per
jump are the guard; they must be re-run on any VitePress upgrade.

**One fade per jump.** The paths overlap, so `createFlashOnce` drops a second
arrival for the row element last flashed, however late it lands (hydration can
outlast any time window). Only a deliberate repeat click restarts the fade,
after 250 ms, and a new element for the same hash counts as a new landing. The
class is removed and re-added around a forced reflow, because re-adding a class
never restarts a CSS animation on its own; the listener that drops the class on
the row's own `animationend` is aborted when the next jump cuts the fade short.

**What the mark looks like.** The row fades from a new `--api-c-flash` token
(`#fdf3e3` light, `#352d22` dark) to its own background over 1.5 s, ease-out,
and a 2 px dashed brand-1 outline just outside the row fades with it. The token
is pale on purpose: `--vp-c-brand-soft`, the obvious choice, composites to about
4.3:1 under brand-1 text, and the row carries brand links, type links, muted
summaries and deprecated marks. The outline is the cue a reader with low
contrast sensitivity sees; dashed, so it is not read as the theme's solid focus
ring, and outside the row, where text starts at the edge. Under reduced motion
nothing animates and both the color and the outline stay until the next jump.
Under forced colors author backgrounds are dropped, so the outline is held at
`Highlight` through the fade.

## Consequences

- Every jump to a member row shows one fade (or one static mark), including
  repeat jumps, back and forward, and cross-page links.
- Every text color a row can carry stays at AA on the flash color; the theme's
  own tokens are pinned in Jest and the rendered colors of both member lists
  are measured in the browser, light and dark.
- The row's box, attributes, focus order and accessible name do not change.
- The `:target` tint no longer shows once the module is installed; a reader
  without JavaScript still gets it.
- A VitePress upgrade that changes how the router writes history state or
  dispatches `hashchange` can break the one-fade guarantee; the e2e counts fail
  loudly rather than flashing twice silently.
