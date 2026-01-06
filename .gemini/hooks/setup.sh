#!/bin/bash
# Extension setup script - installs server dependencies if missing
# Called by SessionStart hook on first run after installation

set -e

# Gemini CLI uses different env vars than Claude Code
# Try Gemini first, fall back to script location
if [ -n "${GEMINI_EXTENSION_PATH}" ]; then
    EXTENSION_ROOT="${GEMINI_EXTENSION_PATH}"
elif [ -n "${extensionPath}" ]; then
    EXTENSION_ROOT="${extensionPath}"
else
    # Fall back to deriving from script location
    EXTENSION_ROOT="$(dirname "$(dirname "$(dirname "$0")")")"
fi

SERVER_DIR="${EXTENSION_ROOT}/server"

# Check if node_modules exists
if [ ! -d "${SERVER_DIR}/node_modules" ]; then
    echo "Installing server dependencies..." >&2
    cd "${SERVER_DIR}"
    npm install --production --silent 2>&1 | head -5 >&2
    echo "Dependencies installed successfully" >&2
fi
