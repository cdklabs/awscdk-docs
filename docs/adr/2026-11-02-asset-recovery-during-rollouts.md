# Asset Recovery During Rollouts

## Status

Accepted

## Context

The hosted site is served by a fleet that takes a new build host by host. Every page loads content-hashed files from
`assets/` (the theme stylesheet, the metadata chunk, the app and framework chunks, the page's own chunk), and a rebuild
changes most of those names. While a rollout is in progress, a page from one build can request its assets from a host
that still serves the other build, and that request gets a 404.

I saw this on 2026-11-02. The live HTML referenced `assets/chunks/metadata.505596b9.js`, and a request for it returned
the site's 404 page with `Last-Modified` from the previous build, while the same file returned 200 two minutes later.
Depending on which file fails, the reader sees an unstyled page, a page whose controls do nothing (no site data), or the
not-found view on a page that exists (the router falls back to it when a page chunk does not load).

The 404 for an asset carries `Cache-Control: max-age=300`, so a browser can reuse the failure for five minutes, and a
plain reload does not help within that time.

We cannot make the rollout atomic from this repository. The fix has to work with whatever host each request reaches.

## Decision

- **An inline script at the top of every page's `<head>`.** `transformHtml` puts it right after `<meta charset>`,
  ahead of the stylesheet and module tags VitePress emits, so its capturing `error` listener is installed before any of
  them can fail. It is not in `head` config, which VitePress renders after those tags and also ships in the metadata
  chunk.
- **What counts as a failure.** An `error` event from a `link` or `script` under `<base>assets/`, a `vite:preloadError`,
  a stylesheet under `assets/` with no `sheet` at `load`, no `__VP_SITE_DATA__` at `load`, or the not-found view
  mounting on a page the server rendered as a real page (the view calls the script's global).
- **Recovery.** Fetch every `assets/` URL the page referenced or requested again with `cache: "reload"`, which replaces
  any cached 404, then reload. Each request may reach another host.
- **Bounded.** At most two reloads per path in 60 seconds, counted in `sessionStorage`. The second waits a second.
  Without `sessionStorage` there is no reload. A load with no failure clears the count.
- **The real 404 page never reloads.** The script knows it is on `404.md` from the build, and the not-found view only
  triggers recovery when the URL is not the one the server answered with that page.

## Consequences

- A reader who hits a mixed rollout sees one or two quick reloads instead of a broken page, for as long as some host can
  serve the files. If none can, the page stops after two reloads and looks as it does without this script.
- A link to a missing page reached by client-side navigation now costs one full page load before the not-found view,
  because the server decides whether the page exists.
- Every page carries about 2 KB more inline script.
- This does not prevent the race. Removing it needs the hosting side to switch builds atomically or keep a reader on one
  host.
