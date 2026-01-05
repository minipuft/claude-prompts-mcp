#!/bin/bash
# Plugin setup script - installs server dependencies if missing
# Called by SessionStart hook on first run after installation

set -e

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
SERVER_DIR="${PLUGIN_ROOT}/server"

# Check if node_modules exists
if [ ! -d "${SERVER_DIR}/node_modules" ]; then
    echo "Installing server dependencies..." >&2
    cd "${SERVER_DIR}"
    npm install --production --silent 2>&1 | head -5 >&2
    echo "Dependencies installed successfully" >&2
fi
