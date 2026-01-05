#!/bin/bash
# Sync plugin source to Claude Code cache
# Run after modifying hooks or plugin.json, then restart Claude Code
# Works from any directory

set -e

# Resolve source dir relative to script location (not cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_BASE="$HOME/.claude/plugins/cache/minipuft-marketplace/claude-prompts-mcp"

# Find the version directory (usually 1.0.0)
if [ -d "$CACHE_BASE" ]; then
    VERSION_DIR=$(ls -1 "$CACHE_BASE" | head -1)
    CACHE_DIR="$CACHE_BASE/$VERSION_DIR"
else
    # Default to 1.0.0 if cache doesn't exist yet
    VERSION_DIR="1.0.0"
    CACHE_DIR="$CACHE_BASE/$VERSION_DIR"
fi

echo "Syncing plugin to cache..."
echo "  Source: $SOURCE_DIR"
echo "  Cache:  $CACHE_DIR"

# Create cache directory if needed
mkdir -p "$CACHE_DIR"

# Sync essential directories
cp -r "$SOURCE_DIR/.claude-plugin" "$CACHE_DIR/"
cp -r "$SOURCE_DIR/hooks" "$CACHE_DIR/"

# Sync server cache if it exists (for hook lookups)
if [ -d "$SOURCE_DIR/server/cache" ]; then
    mkdir -p "$CACHE_DIR/server"
    cp -r "$SOURCE_DIR/server/cache" "$CACHE_DIR/server/"
fi

echo ""
echo "Sync complete. Files synced:"
ls -la "$CACHE_DIR/" | grep -E "^d" | awk '{print "  " $NF}'

echo ""
echo "Next: Restart Claude Code (/exit then claude) to reload hooks"
