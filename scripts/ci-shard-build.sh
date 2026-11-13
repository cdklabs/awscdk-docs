#!/usr/bin/env bash
# Usage: ci-shard-build.sh <shards> <heap-mb> <concurrency>
# DOCS_BUILD_SHARDS, DOCS_BUILD_HEAP_MB and DOCS_BUILD_CONCURRENCY override the arguments, so a rerun can resize the build.
set -euo pipefail
cd "$(dirname "$0")/.."

exec bash scripts/local-shard-build.sh \
  --num-shards "${DOCS_BUILD_SHARDS:-$1}" \
  --heap "${DOCS_BUILD_HEAP_MB:-$2}" \
  --concurrency "${DOCS_BUILD_CONCURRENCY:-$3}"
