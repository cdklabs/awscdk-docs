# Asset Recovery During Rollouts

## Status

Accepted

## Context

The hosted site takes a new build host by host. Most `assets/` file names change between builds, so during a rollout a
page can request an asset from a host on the other build and get a 404. On 2026-11-02 I saw the live HTML reference
`assets/chunks/metadata.505596b9.js`, which returned the previous build's 404 page and then 200 two minutes later.
Depending on the file, the page is unstyled, its controls do nothing, or it shows the not-found view although it exists.

The 404 is sent with `Cache-Control: max-age=300`, so a reload alone can reuse it. This repository cannot make the
rollout atomic.

## Decision

An inline script right after `<meta charset>` on every page, ahead of the stylesheet and module tags. When a `link` or
`script` under `assets/` fails, or the not-found view mounts on a page the server rendered as a real page, it refetches
the page's `assets/` URLs with `cache: "reload"` and reloads. Each request may reach another host.

It reloads a path at most twice per tab session, counted in `sessionStorage`. The 404 page the host serves for a
missing address never reloads.

## Consequences

- A reader in a rollout sees a reload instead of a broken page, as long as some host has the files.
- A link to a missing page followed client-side costs one extra page load before the not-found view.
- A path that used up its two reloads does not recover again in that tab.
- The race itself remains. Removing it needs the hosting side to switch builds atomically.
