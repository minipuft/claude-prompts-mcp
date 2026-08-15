#!/bin/bash
# Build the Claude Desktop Extension from the server's locked production tree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
STAGING_DIR="$ROOT_DIR/.mcpb-staging"
OUTPUT_FILE="$ROOT_DIR/claude-prompts.mcpb"
SMOKE_WORKSPACE="$(mktemp -d "${TMPDIR:-/tmp}/claude-prompts-mcpb-smoke.XXXXXX")"
MCPB_BIN="$ROOT_DIR/node_modules/.bin/mcpb"

cleanup() {
  rm -rf "$STAGING_DIR" "$SMOKE_WORKSPACE"
}
trap cleanup EXIT

if [[ ! -x "$MCPB_BIN" ]]; then
  echo "ERROR: MCPB CLI missing. Run 'npm ci' from the repository root." >&2
  exit 1
fi

echo "==> Building Claude Desktop Extension"

echo "==> Cleaning staging directory..."
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/server"

# Build server if needed
echo "==> Building server..."
cd "$ROOT_DIR/server"
npm run build:prod

# Copy manifest and essential files
echo "==> Copying files..."
cp "$ROOT_DIR/manifest.json" "$STAGING_DIR/"
cp "$ROOT_DIR/LICENSE" "$STAGING_DIR/"
cp "$ROOT_DIR/.node-version" "$STAGING_DIR/" 2>/dev/null || true

# The icon `manifest.json` names. Copied at its repository path so the manifest value
# and the source file are the same string — a renamed staging copy would make the
# manifest describe a file that exists nowhere in the repo. Not optional: the MCPB
# manifest declares `icon`, so a missing file here ships an extension whose declared
# artwork does not resolve, which is worse than the no-icon state it replaced.
mkdir -p "$STAGING_DIR/assets"
cp "$ROOT_DIR/assets/icon-512.png" "$STAGING_DIR/assets/icon-512.png"

# Copy the exposed server runtime and resources. The cpm CLI is distributed through
# npm and GitHub Releases; MCPB does not register a cpm executable.
bash "$ROOT_DIR/scripts/stage-server-runtime.sh" \
  "$ROOT_DIR/server/dist" "$STAGING_DIR/server/dist"
cp -r "$ROOT_DIR/server/resources" "$STAGING_DIR/server/"
cp "$ROOT_DIR/server/config.json" "$STAGING_DIR/server/"
cp "$ROOT_DIR/server/LICENSE" "$STAGING_DIR/server/"

# Copy skills
cp -r "$ROOT_DIR/skills" "$STAGING_DIR/" 2>/dev/null || true

echo "==> Generating the staged package contract..."
node - "$ROOT_DIR/server/package.json" "$STAGING_DIR/server/package.json" <<'NODE'
const fs = require('node:fs');
const [sourcePath, outputPath] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const staged = {
  name: source.name,
  version: source.version,
  type: source.type,
  main: source.main,
};
fs.writeFileSync(outputPath, `${JSON.stringify(staged, null, 2)}\n`);
NODE

MCP_WORKSPACE="$SMOKE_WORKSPACE" node "$STAGING_DIR/server/dist/index.js" --startup-test
rm -rf "$STAGING_DIR/server/runtime-state"
node "$ROOT_DIR/server/scripts/validate-extension-artifact.js" --staging-dir "$STAGING_DIR"

# Pack using mcpb
echo "==> Packing extension..."
cd "$STAGING_DIR"
rm -f "$OUTPUT_FILE"
"$MCPB_BIN" pack . "$OUTPUT_FILE"

echo "==> Verifying packed extension inventory..."
ARCHIVE_FILES="$(unzip -Z1 "$OUTPUT_FILE")"
grep -qx 'server/dist/index.js' <<<"$ARCHIVE_FILES" || {
  echo "ERROR: packed extension is missing server/dist/index.js" >&2
  exit 1
}
# No icon assertion here on purpose. `mcpb pack` validates `manifest.json`'s `icon` against
# the staging tree and REFUSES to pack when the file is absent ("Icon validation failed:
# Icon file not found at path: ..."), so an archive-level check can never fire. Measured
# 2026-08-14: removing the copy above fails the build at pack time, and no arrangement of
# `.mcpbignore` produced a packed archive whose declared icon was missing. A gate that
# cannot fire reads as coverage while providing none.
for forbidden in \
  'server/dist/cpm.js' \
  'server/dist/cpm.js.map' \
  'server/node_modules/' \
  'server/runtime-state/'; do
  if grep -q "^${forbidden}" <<<"$ARCHIVE_FILES"; then
    echo "ERROR: packed extension contains forbidden path: $forbidden" >&2
    exit 1
  fi
done
node - "$OUTPUT_FILE" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const budget = 3_000_000;
const bytes = fs.statSync(file).size;
if (bytes > budget) throw new Error(`MCPB size ${bytes} exceeds ${budget} bytes`);
console.log(`  MCPB size: ${bytes} bytes (budget ${budget})`);
NODE

# Show results
echo ""
echo "==> Build complete!"
ls -lh "$OUTPUT_FILE"

echo "==> Cleaning up staging directories..."
