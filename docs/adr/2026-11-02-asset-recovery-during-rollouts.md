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

An inline script right after `<meta charset>` on every page, ahead of the stylesheet and module tags. It reloads only
when it has evidence that a reload can help:

- When a `link` (other than a prefetch) or `script` under `assets/` fails, it requests that file again with
  `cache: "reload"`, which also replaces the cached 404, and reloads if the response is OK.
- When the not-found view mounts, it requests the current URL and reloads if the server serves it, which means the page
  exists and only its chunk failed.

A path reloads at most twice per tab session, counted in `sessionStorage`.

## Consequences

- A reader in a rollout sees a reload instead of a broken page when another host has the file.
- Offline, with the file gone from every host (a broken deploy, or HTML cached from a build that no longer exists), or
  on a real 404, the page does not reload and looks as it does without the script.
- Every not-found view costs one extra request for the current URL.
- The race itself remains. Removing it needs the hosting side to switch builds atomically.
