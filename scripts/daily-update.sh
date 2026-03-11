#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "=== Daily update: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "--- Fetching new data (incremental) ---"
npx tsx scripts/fetch-and-analyze.ts --days 90

echo "--- Rebuilding dashboard ---"
npm run build

echo "=== Done ==="
