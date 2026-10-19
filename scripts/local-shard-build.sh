#!/usr/bin/env bash
# One-stop local sharded production build: docs:generate once, then prune+build
# every shard in an isolated workspace (parallel), merge the dists and index
# the merged site. Produces the same tree the CI pipeline deploys, at the
# site directory printed on completion.
#
# Usage: local-shard-build.sh [options]
#   --num-shards N    total shards, built in parallel (default: CPU cores - 2)
#   --shard I/T       build only shard I of T (0-based; incompatible with --num-shards)
#   --heap MB         per-shard node old-space cap (default: node's own default)
#   --concurrency N   max shards building at once (default: all of them)
#   --base PATH       site base path, e.g. /cdk/api/ (default: env DOCS_BASE or /)
#   -h, --help        show this help
#
# DOCS_BASE is honored like every other build path: set it to get the hosted
# tree (docs/.vitepress/dist/cdk/api), leave it unset for a root-served build.
set -euo pipefail

# Kill the whole process group on interrupt: shard builds are node processes
# with their own SIGINT handling and would otherwise keep running orphaned.
trap 'trap - INT TERM; kill 0' INT TERM

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SELF="$ROOT/scripts/local-shard-build.sh"

usage() { sed -n '2,16p' "$SELF" | sed 's/^# \{0,1\}//'; }
die() { echo "error: $*" >&2; exit 2; }

# --- one shard, in its own workspace; invoked via xargs as: SELF __run-shard <i> ---
run_shard() {
  local i="$1"
  local ws="$WORK/shard-$i"
  local log="$WORK/shard-$i.log"
  echo "shard $i/$TOTAL: started (log: $log)"
  # Subshell: the cd must not leak into the caller.
  (
    echo "[shard $i] setting up workspace: $ws"
    rm -rf "$ws"
    mkdir -p "$ws/docs/.vitepress"
    ln -s "$ROOT/node_modules" "$ws/node_modules"
    ln -s "$ROOT/src" "$ws/src"
    ln -s "$ROOT/scripts" "$ws/scripts"
    ln -s "$ROOT/package.json" "$ws/package.json"
    ln -s "$ROOT/versions.snapshot.json" "$ws/versions.snapshot.json"
    # The theme compiles the language gate straight from the docgen config
    # (docs/.vitepress/theme/enabled-languages.ts), so the workspace must
    # carry it at the same root-relative spot.
    ln -s "$ROOT/docgen.config.json" "$ws/docgen.config.json"
    # Copy the docs tree, excluding build outputs (dist/cache), as
    # copy-on-write clones where the filesystem supports them.
    clone() { cp -cR "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; }; }
    for entry in "$ROOT/docs"/*; do
      name="$(basename "$entry")"
      [ "$name" = ".vitepress" ] && continue
      clone "$entry" "$ws/docs/$name"
    done
    for entry in "$ROOT/docs/.vitepress"/*; do
      name="$(basename "$entry")"
      case "$name" in dist|cache) continue ;; esac
      clone "$entry" "$ws/docs/.vitepress/$name"
    done

    cd "$ws"
    echo "[shard $i] pruning to shard $i/$TOTAL"
    SHARD_INDEX="$i" SHARD_TOTAL="$TOTAL" node scripts/shard-prune.cjs

    echo "[shard $i] building"
    node_args=()
    [ -n "${HEAP:-}" ] && node_args+=("--max-old-space-size=$HEAP")
    SHARD_BUILD=1 node ${node_args[@]+"${node_args[@]}"} ./node_modules/.bin/vitepress build docs

    echo "[shard $i] verifying shard output"
    node scripts/shard-verify.cjs
  ) >"$log" 2>&1
  touch "$WORK/shard-$i.ok"
  echo "shard $i/$TOTAL: done"
}

if [ "${1:-}" = "__run-shard" ]; then
  run_shard "$2"
  exit 0
fi

# --- argument parsing ---
HEAP="" NUM_SHARDS="" SINGLE="" CONCURRENCY="" BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift ;; # projen's receiveArgs forwards the bare separator
    --heap) HEAP="${2:-}"; shift 2 ;;
    --heap=*) HEAP="${1#*=}"; shift ;;
    --num-shards) NUM_SHARDS="${2:-}"; shift 2 ;;
    --num-shards=*) NUM_SHARDS="${1#*=}"; shift ;;
    --shard) SINGLE="${2:-}"; shift 2 ;;
    --shard=*) SINGLE="${1#*=}"; shift ;;
    --concurrency) CONCURRENCY="${2:-}"; shift 2 ;;
    --concurrency=*) CONCURRENCY="${1#*=}"; shift ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --base=*) BASE="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

# The flag wins over an inherited DOCS_BASE; site-paths.cjs normalizes slashes.
[ -n "$BASE" ] && export DOCS_BASE="$BASE"

[ -n "$SINGLE" ] && [ -n "$NUM_SHARDS" ] && die "--shard and --num-shards are incompatible"
[ -z "$HEAP" ] || echo "$HEAP" | grep -Eq '^[0-9]+$' || die "--heap must be an integer (MB), got: $HEAP"
[ -z "$CONCURRENCY" ] || echo "$CONCURRENCY" | grep -Eq '^[1-9][0-9]*$' || die "--concurrency must be a positive integer, got: $CONCURRENCY"

if [ -n "$SINGLE" ]; then
  echo "$SINGLE" | grep -Eq '^[0-9]+/[1-9][0-9]*$' || die "--shard must be I/T (e.g. 3/40), got: $SINGLE"
  SHARD_I="${SINGLE%/*}"
  TOTAL="${SINGLE#*/}"
  [ "$SHARD_I" -lt "$TOTAL" ] || die "--shard index $SHARD_I must be < total $TOTAL (0-based)"
else
  if [ -n "$NUM_SHARDS" ]; then
    echo "$NUM_SHARDS" | grep -Eq '^[1-9][0-9]*$' || die "--num-shards must be a positive integer, got: $NUM_SHARDS"
    TOTAL="$NUM_SHARDS"
  else
    CORES="$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu )"
    TOTAL=$(( CORES - 2 ))
    [ "$TOTAL" -ge 1 ] || TOTAL=1
  fi
fi
CONCURRENCY="${CONCURRENCY:-$TOTAL}"

# --- build ---
cd "$ROOT"
# Shared parent in temp; a fresh subdirectory per run keeps runs independent.
TMP_PARENT="${TMPDIR:-/tmp}"
TMP_PARENT="${TMP_PARENT%/}/cdk-docs-shards"
mkdir -p "$TMP_PARENT"
WORK="$(mktemp -d "$TMP_PARENT/run.XXXXXX")"
export ROOT WORK TOTAL HEAP

if [ -n "$SINGLE" ]; then
  echo "Plan: single shard $SHARD_I of $TOTAL${HEAP:+, heap ${HEAP}MB}, base ${DOCS_BASE:-/}"
else
  echo "Plan: $TOTAL shards, $CONCURRENCY in parallel${HEAP:+, heap ${HEAP}MB per shard}, base ${DOCS_BASE:-/}"
fi

echo "Generating docs (once) ..."
npx projen docs:generate

if [ -n "$SINGLE" ]; then
  echo "Building shard $SHARD_I/$TOTAL ..."
  run_shard "$SHARD_I"
  SOURCES=("$WORK/shard-$SHARD_I")
else
  echo "Building $TOTAL shards ($CONCURRENCY in parallel) ..."
  seq 0 $(( TOTAL - 1 )) | xargs -n1 -P "$CONCURRENCY" "$SELF" __run-shard || true
  FAILED=""
  SOURCES=()
  for i in $(seq 0 $(( TOTAL - 1 ))); do
    if [ -f "$WORK/shard-$i.ok" ]; then
      SOURCES+=("$WORK/shard-$i")
    else
      FAILED="$FAILED $i"
    fi
  done
  if [ -n "$FAILED" ]; then
    for i in $FAILED; do
      echo "--- shard $i failed; last lines of $WORK/shard-$i.log:" >&2
      tail -20 "$WORK/shard-$i.log" >&2 || true
    done
    echo "error: shard(s)$FAILED failed — workspaces kept for inspection under $WORK" >&2
    exit 1
  fi
fi

# --- merge, index, clean up ---
REL_DIST="$(node -p "require('./scripts/site-paths.cjs').distDir()")"
MERGE_SOURCES=()
for s in "${SOURCES[@]}"; do MERGE_SOURCES+=("$s/$REL_DIST"); done
# The agent-oriented Markdown twins come from the docs:generate run above; the tree is site-root-relative, and
# REL_DIST already carries the hosted base, so it overlays directly. A single-shard run is a partial site for
# debugging one slice, so it does not carry the twins.
AGENT_MARKDOWN=()
[ -n "$SINGLE" ] || AGENT_MARKDOWN=(--agent-markdown dist-agent-markdown)
node scripts/merge-shards.cjs "$REL_DIST" "${AGENT_MARKDOWN[@]}" "${MERGE_SOURCES[@]}"

if [ -n "$SINGLE" ]; then
  echo "Single-shard build: skipping site verification (needs the full site)."
else
  bash scripts/verify-site.sh
fi

for s in "${SOURCES[@]}"; do rm -rf "$s"; done

echo ""
echo "Total: $(( SECONDS / 60 ))m$(( SECONDS % 60 ))s"
echo "Site: $REL_DIST"
echo "Preview with: npx projen docs:preview"
