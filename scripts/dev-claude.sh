#!/bin/bash
# Start Claude Code with local plugin (bypasses cache, uses plugin schema)
#
# Usage:
#   ./scripts/dev-claude.sh           # Start new session
#   ./scripts/dev-claude.sh --resume  # Resume last session
#
# Benefits:
#   - Changes take effect immediately (after restart)
#   - No version bumping needed during development
#   - No cache sync needed
#   - Avoids .mcp.json schema conflict (uses plugin schema, not project schema)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Ensure server is built
if [ ! -f "$PLUGIN_DIR/server/dist/index.js" ]; then
  echo "Building plugin server..."
  (cd "$PLUGIN_DIR/server" && npm run build)
fi

echo "Starting Claude Code with plugin from: $PLUGIN_DIR"
exec claude --plugin-dir "$PLUGIN_DIR" "$@"
