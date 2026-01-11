#!/bin/bash
# Validates that dist/index.js is up-to-date with source
# Used in CI to catch stale bundles before they're released

set -e

echo "Checking dist freshness..."

# Get hash of current dist
DIST_HASH=$(md5sum dist/index.js 2>/dev/null | cut -d' ' -f1 || echo "none")

# Rebuild
npm run build --silent

# Get hash after rebuild
NEW_HASH=$(md5sum dist/index.js | cut -d' ' -f1)

if [ "$DIST_HASH" != "$NEW_HASH" ]; then
  echo "❌ dist/index.js is stale!"
  echo "   The committed dist/ does not match the source code."
  echo "   Run 'npm run build' locally and commit the updated dist/"
  exit 1
fi

echo "✅ dist/index.js is up-to-date with source"
