#!/usr/bin/env bash
set -euo pipefail
exec npx tsx src/docgen/history-backfill-cli.ts "$@"
