# Explorer Preview: An Opt-In View Rail In The Sidebar

## Status

Accepted

## Context

The API sidebar will later get more views, such as a grouping by service, by package or by framework. Before that work, the team wants to try the rail itself with real readers: whether a narrow rail at the sidebar's left edge works as the place to switch views. Putting the rail in front of every reader would move people who did not ask for it, and a rail that is hard to take back out is hard to learn from.

## Decision

The rail ships as an opt-in preview. It is off by default, and with it off the only change is the new switch.

- **The switch.** The Settings panel gets a last group, `Explorer preview`, with segments `Off` and `On`, rendered by `ExplorerPreviewPicker.vue` on the same segmented `aria-pressed` track as the navigation style. The phone menu screen carries the same group as a full-width row under the navigation row. `docs/.vitepress/theme/explorer-preview.ts` holds the state: `cdk-docs-explorer-preview` is `on` or `off` (anything else means off) and `cdk-docs-explorer-view` is `api` or `favorites` (anything else means `api`).
- **Two attributes.** With the preview on, `<html>` carries `data-explorer-preview="on"` and `data-explorer-view`. A head script in `config.mts` sets both before first paint, so a reload never moves the page by the rail's width. Every rule that changes the preview-off layout keys on the attribute, in `explorer-preview.css`; the rail's own classes and the phone-menu switch row are unkeyed.
- **The rail.** `ExplorerRail.vue` renders a 72px column at the sidebar's left edge, only on pages with the API sidebar and only while the preview is on. It holds two view buttons, `API` and `Favorites`, and nothing else. Each is a `<button>` with `aria-pressed`. The sidebar grows from 320px to 392px, on pages that have it, and its left padding grows by 72px (from 32px to 104px below 1440px), so the tree keeps its 256px content width. The rail is `position: fixed`; the sidebar's own `transform` would make it the containing block for fixed children, so the transform is dropped while the preview is on.
- **The views.** The API view is today's sidebar without its Favorites section. The Favorites view shows today's favorites list, always open, with one line of text when it is empty, and hides the filter and the tree. In this view the `.sidebar-header` is not pinned, so a long list scrolls with the sidebar instead of being clipped by the header. The stored collapsed state of the Favorites section is ignored in the Favorites view and kept for the preview-off sidebar.
- **Settings.** The top-bar gear stays on every page from 768px up, and opens the same panel it opens with the preview off, now including the `Explorer preview` group; below 768px `nav-controls.css` hides it and the phone menu screen carries the same group. The rail has no Settings button and opens no panel. Turning the preview on leaves focus on the `On` segment, which does not move. Turning it off from the gear's panel closes the panel and moves focus back to the gear; from the phone menu row the pressed segment keeps focus, because the gear is hidden there.
- **Phones.** Below 960px the drawer starts with a 44px `Views` button showing the current view. It unfolds the rail over a scrim. While it is unfolded, the controls it covers (the Views button, the filter, the Favorites list and the tree) are `inert`, and Tab wraps between the two view buttons. Picking a view, Escape or a tap on the scrim folds it and returns focus to the button. A route change, turning the preview off, widening the viewport past 959px, or focus moving out of the rail also folds it, and focus stays where it was. The phone menu screen keeps its settings rows, the preview switch included, with the preview on or off.

## Consequences

- The rail does not hold Settings. This keeps the switch that turns the preview off reachable on pages without the sidebar, such as the home page, Skills and Versions. The rail's earlier design put Settings at its bottom and hid the gear; the reversal was proposed during design review, after seeing that those pages then had no way to reach Settings, and a maintainer approved it.
- The page column is 72px narrower on desktop with the preview on. Final widths belong to the later work that adds more views.
- `API` is the working name of the first view and may change when more views arrive.
- With the preview on, the title lane is 392px on every page, so the top bar's geometry stays page-independent within each mode, as the navbar ADR requires. From 960px to 1119px the version badge is hidden in the bar on every page so the gear keeps its 32px inset from the viewport edge, as with the preview off; this is the one exception to the navbar ADR's rule that the version stays visible, the Versions link next to it leads to the same page, and the row needs no cut from 1120px. The phone menu screen changes only by the new `Explorer preview` group.
- Removing the preview later means deleting the switch, the rail and the Views button, the stylesheet, the head script in `config.mts`, and the preview branches in `FavoritesList.vue` and `SettingsMenu.vue`, with their slots in `index.ts` and the two glyphs.
