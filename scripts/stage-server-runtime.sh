#!/bin/bash

# Stage only the MCP server entrypoint exposed by plugin and MCPB manifests.

set -euo pipefail

SOURCE_DIR="${1:?source dist directory is required}"
TARGET_DIR="${2:?target dist directory is required}"
RUNTIME_FILES=("index.js" "index.js.map")

mkdir -p "$TARGET_DIR"
# Enforce the allowlist even when updating an existing cache with stale files from
# an older broad-copy build. The bundled server contract is intentionally single-file.
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 \
  ! -name 'index.js' ! -name 'index.js.map' -exec rm -rf -- {} +
for file in "${RUNTIME_FILES[@]}"; do
  if [[ ! -f "$SOURCE_DIR/$file" ]]; then
    echo "ERROR: required server runtime file is missing: $SOURCE_DIR/$file" >&2
    exit 1
  fi
  cp "$SOURCE_DIR/$file" "$TARGET_DIR/$file"
done
