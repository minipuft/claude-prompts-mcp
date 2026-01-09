#!/bin/bash
# Sync plugin source to Claude Code cache
# Auto-detects installation path from installed_plugins.json or known locations
# Run after modifying hooks or plugin.json, then restart Claude Code

set -e

# Resolve source dir relative to script location (not cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Function to find cache directory
find_cache_dir() {
    local INSTALLED_PLUGINS="$HOME/.claude/plugins/installed_plugins.json"

    # Method 1: Parse installed_plugins.json for exact path
    if [ -f "$INSTALLED_PLUGINS" ]; then
        # Look for claude-prompts@minipuft installation
        local INSTALL_PATH=$(grep -o '"installPath": "[^"]*claude-prompts[^"]*"' "$INSTALLED_PLUGINS" | head -1 | sed 's/"installPath": "//;s/"$//')
        if [ -n "$INSTALL_PATH" ] && [ -d "$INSTALL_PATH" ]; then
            echo "$INSTALL_PATH"
            return 0
        fi
    fi

    # Method 2: Check known cache locations in priority order
    local KNOWN_PATHS=(
        "$HOME/.claude/plugins/cache/minipuft/claude-prompts"
        "$HOME/.claude/plugins/cache/minipuft-marketplace/claude-prompts-mcp"
    )

    for BASE_PATH in "${KNOWN_PATHS[@]}"; do
        if [ -d "$BASE_PATH" ]; then
            # Get latest version directory
            local VERSION_DIR=$(ls -1 "$BASE_PATH" 2>/dev/null | sort -V | tail -1)
            if [ -n "$VERSION_DIR" ]; then
                echo "$BASE_PATH/$VERSION_DIR"
                return 0
            fi
        fi
    done

    # Method 3: Default fallback (marketplace path)
    echo "$HOME/.claude/plugins/cache/minipuft/claude-prompts/1.1.0"
    return 1
}

# Find the cache directory
CACHE_DIR=$(find_cache_dir)
FOUND=$?

echo "Syncing plugin to cache..."
echo "  Source: $SOURCE_DIR"
echo "  Cache:  $CACHE_DIR"

if [ $FOUND -ne 0 ]; then
    echo "  (Note: Cache directory not found, creating default)"
fi

# Create cache directory if needed
mkdir -p "$CACHE_DIR"

# Sync essential directories
cp -r "$SOURCE_DIR/.claude-plugin" "$CACHE_DIR/"
cp -r "$SOURCE_DIR/hooks" "$CACHE_DIR/"
cp -r "$SOURCE_DIR/.mcp.json" "$CACHE_DIR/" 2>/dev/null || true

# Sync server directory (needed for MCP server and cache)
if [ -d "$SOURCE_DIR/server" ]; then
    mkdir -p "$CACHE_DIR/server"
    # Sync dist (compiled server)
    if [ -d "$SOURCE_DIR/server/dist" ]; then
        cp -r "$SOURCE_DIR/server/dist" "$CACHE_DIR/server/"
    fi
    # Sync cache (prompt metadata for hooks)
    if [ -d "$SOURCE_DIR/server/cache" ]; then
        cp -r "$SOURCE_DIR/server/cache" "$CACHE_DIR/server/"
    fi
    # Sync resources (prompts, gates, methodologies)
    if [ -d "$SOURCE_DIR/server/resources" ]; then
        cp -r "$SOURCE_DIR/server/resources" "$CACHE_DIR/server/"
    fi
fi

echo ""
echo "Sync complete. Files synced:"
ls -la "$CACHE_DIR/" | grep -E "^d|^-" | awk '{print "  " $NF}'

echo ""
echo "Next: Restart Claude Code (/exit then claude) to reload hooks"
