# Explorer Preview: An Opt-In View Rail In The Sidebar

## Status

Accepted

## Context

The API sidebar will later get more views, such as a grouping by service, by package or by framework. Before that work, the team wants to try the rail itself with real readers: whether a narrow rail at the sidebar's left edge works as the place to switch views and to reach settings. Putting the rail in front of every reader would move people who did not ask for it, and a rail that is hard to take back out is hard to learn from.

## Decision

The rail ships as an opt-in preview. It is off by default, and with it off the site is exactly what it was.

- **The switch.** The Settings panel gets a last group, `Explorer preview`, with segments `Off` and `On`, rendered by `ExplorerPreviewPicker.vue` on the same segmented `aria-pressed` track as the navigation style. The phone menu screen carries the same group as a full-width row under the navigation row. `docs/.vitepress/theme/explorer-preview.ts` holds the state: `cdk-docs-explorer-preview` is `on` or `off` (anything else means off) and `cdk-docs-explorer-view` is `api` or `favorites` (anything else means `api`).
- **One attribute for every rule.** With the preview on, `<html>` carries `data-explorer-preview="on"` and `data-explorer-view`. A head script in `config.mts` sets both before first paint, so a reload never moves the page by the rail's width. All preview CSS keys on the attribute, in `explorer-preview.css`.
- **The rail.** `ExplorerRail.vue` renders a 72px column at the sidebar's left edge, only on pages with the API sidebar and only while the preview is on. It holds two view buttons, `API` and `Favorites`, and a `Settings` button at the bottom. Each is a `<button>`; the views carry `aria-pressed`, and Settings keeps the gear's disclosure contract (`aria-haspopup`, `aria-expanded`, `aria-controls`). The sidebar grows from 320px to 392px and its left padding from 32px to 104px, so the tree keeps its 256px content width. The rail is `position: fixed`; the sidebar's own `transform` would make it the containing block for fixed children, so the transform is dropped while the preview is on.
- **The views.** The API view is today's sidebar without its Favorites section. The Favorites view shows today's favorites list, always open, with one line of text when it is empty, and hides the filter and the tree. The stored collapsed state of the Favorites section is ignored in the Favorites view and kept for the preview-off sidebar.
- **Settings.** The top-bar gear leaves, at every width. The rail's Settings button opens the same panel, so the panel renders in one place at a time: in `SettingsMenu.vue` with the preview off and in the rail with it on. The open state is shared. Turning the preview on keeps focus on the `On` segment of the panel's new copy; turning it off moves focus to the gear. Where that control is not visible, focus goes to the nearest visible one instead of falling to the page: the menu button or the search button when turning on from the phone menu or from a page without the rail, and the drawer's filter when turning off from the rail on a phone.
- **Phones.** Below 960px the drawer starts with a 44px `Views` button showing the current view. It unfolds the rail over a scrim; picking a view, Escape or a tap on the scrim folds it, and focus returns to the button. The phone menu screen drops its theme, navigation and preview rows, because Settings is reached from the rail.

## Consequences

- A page without the API sidebar, such as the home page, has no way to open Settings while the preview is on, because the gear is gone and the rail is not there. A reader turns the preview off from any API page.
- The page column is 72px narrower on desktop with the preview on. Final widths belong to the later work that adds more views.
- `API` is the working name of the first view and may change when more views arrive.
- With the preview off the only visible change is the new `Explorer preview` group in Settings.
- The rail is plain DOM and CSS keyed on one attribute, so removing the preview later means deleting the switch, the rail and the stylesheet.
