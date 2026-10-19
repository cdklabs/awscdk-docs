#!/usr/bin/env bash
# Verify the merged site meets the deploy contract: nav/search assets present,
# only the hosted path at the artifact root, and the page-count floor. Run at the end of every full sharded build, locally
# and in CI, so both enforce the same contract. DOCS_BASE-aware via site-paths.cjs.
set -euo pipefail
cd "$(dirname "$0")/.."

DIST_ROOT="docs/.vitepress/dist"
SITE_DIST="$(node -p "require('./scripts/site-paths.cjs').distDir()")"
BASE="$(node -p "require('./scripts/site-paths.cjs').siteBase()")"

fail() { echo "::error::$*" >&2; exit 1; }

test -f "$SITE_DIST/index.html" || fail "$SITE_DIST/index.html missing — merge did not complete"
test -f "$SITE_DIST/hashmap.json" || fail "$SITE_DIST/hashmap.json missing — client-side navigation would break"
ls "$SITE_DIST"/search/index.*.json >/dev/null 2>&1 || fail "$SITE_DIST/search/index.<hash>.json missing — search index not generated"

# The publishing target takes no loose files at the artifact root.
if [ "$BASE" != "/" ]; then
  ROOT_ENTRY="$(echo "$BASE" | cut -d/ -f2)"
  [ "$(ls -A "$DIST_ROOT")" = "$ROOT_ENTRY" ] || \
    fail "$DIST_ROOT must contain only the hosted path root — found: $(ls -A "$DIST_ROOT" | tr '\n' ' ')"
fi

PAGE_COUNT="$(find "$SITE_DIST" -name "*.html" | wc -l | tr -d ' ')"
echo "Merged site has $PAGE_COUNT HTML pages"
[ "$PAGE_COUNT" -ge 20000 ] || \
  fail "Only $PAGE_COUNT HTML pages found, expected >20000 — a shard likely crashed or the merge dropped pages"
