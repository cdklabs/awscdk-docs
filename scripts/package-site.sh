#!/usr/bin/env bash
# Package the built site as a zip and fail when it is too big to deploy to GitHub Pages.
#
# Usage: package-site.sh <dist-root> <zip>
#
# Zips the contents of <dist-root>, so the archive carries the hosted path (cdk/api/...) and nothing loose at its
# top level. Uses 7z's multithreaded deflate when it is installed, and zip otherwise.
#
# GitHub Pages rejects artifacts over 1 GB of compressed bytes. The zip uses the same deflate compression, so its size
# tracks the Pages artifact; MAX_ZIP_MB (default 900) leaves headroom below that limit.
set -euo pipefail

DIST_ROOT="${1:?usage: package-site.sh <dist-root> <zip>}"
OUT="${2:?usage: package-site.sh <dist-root> <zip>}"
MAX_ZIP_MB="${MAX_ZIP_MB:-900}"

[ -d "$DIST_ROOT" ] || { echo "error: dist root not found: $DIST_ROOT" >&2; exit 2; }
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
rm -f "$OUT"

if command -v 7z >/dev/null 2>&1; then
  (cd "$DIST_ROOT" && 7z a -tzip -mmt=on -bso0 -bsp0 "$OUT" .)
else
  (cd "$DIST_ROOT" && zip -qry "$OUT" .)
fi

SIZE_MB=$(( $(wc -c < "$OUT") / 1048576 ))
echo "Site zip is ${SIZE_MB} MB (limit ${MAX_ZIP_MB} MB)"
if [ "$SIZE_MB" -gt "$MAX_ZIP_MB" ]; then
  echo "::error::Site zip is ${SIZE_MB} MB, too close to the 1 GB GitHub Pages limit. Trim per-page weight before adding more content." >&2
  exit 1
fi
