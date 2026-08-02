#!/bin/bash
# Build the Claude Desktop Extension from the server's locked production tree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
STAGING_DIR="$ROOT_DIR/.mcpb-staging"
OUTPUT_FILE="$ROOT_DIR/claude-prompts.mcpb"
INSTALL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/claude-prompts-mcpb-install.XXXXXX")"
MCPB_BIN="$ROOT_DIR/node_modules/.bin/mcpb"
MCPB_EXCLUDED_DEPS=("chokidar" "ulid")

cleanup() {
  rm -rf "$STAGING_DIR" "$INSTALL_DIR"
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
npm run build

# Copy manifest and essential files
echo "==> Copying files..."
cp "$ROOT_DIR/manifest.json" "$STAGING_DIR/"
cp "$ROOT_DIR/LICENSE" "$STAGING_DIR/"
cp "$ROOT_DIR/.node-version" "$STAGING_DIR/" 2>/dev/null || true

# Copy server dist and resources
cp -r "$ROOT_DIR/server/dist" "$STAGING_DIR/server/"
cp -r "$ROOT_DIR/server/resources" "$STAGING_DIR/server/"
cp "$ROOT_DIR/server/config.json" "$STAGING_DIR/server/"
cp "$ROOT_DIR/server/LICENSE" "$STAGING_DIR/server/"

# Copy skills
cp -r "$ROOT_DIR/skills" "$STAGING_DIR/" 2>/dev/null || true

echo "==> Installing the locked production dependency tree..."
cp "$ROOT_DIR/server/package.json" "$ROOT_DIR/server/package-lock.json" "$INSTALL_DIR/"
if [[ -f "$ROOT_DIR/server/.npmrc" ]]; then
  cp "$ROOT_DIR/server/.npmrc" "$INSTALL_DIR/"
fi
(cd "$INSTALL_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
cp -R "$INSTALL_DIR/node_modules" "$STAGING_DIR/server/"

for dependency in "${MCPB_EXCLUDED_DEPS[@]}"; do
  rm -rf "$STAGING_DIR/server/node_modules/$dependency"
done

# npm creates relative links in .bin. Excluding a bundled package must also remove
# its now-dangling executable link or MCPB refuses to archive the staged tree.
node - "$STAGING_DIR/server/node_modules/.bin" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const binDir = process.argv[2];
if (fs.existsSync(binDir)) {
  for (const entry of fs.readdirSync(binDir)) {
    const entryPath = path.join(binDir, entry);
    if (fs.lstatSync(entryPath).isSymbolicLink() && !fs.existsSync(entryPath)) {
      fs.unlinkSync(entryPath);
    }
  }
}
NODE

echo "==> Generating the staged package contract..."
node - "$ROOT_DIR/server/package.json" "$STAGING_DIR/server/package.json" "${MCPB_EXCLUDED_DEPS[@]}" <<'NODE'
const fs = require('node:fs');
const [sourcePath, outputPath, ...excluded] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const dependencies = Object.fromEntries(
  Object.entries(source.dependencies).filter(([name]) => !excluded.includes(name)),
);
const staged = {
  name: source.name,
  version: source.version,
  type: source.type,
  main: source.main,
  dependencies,
};
fs.writeFileSync(outputPath, `${JSON.stringify(staged, null, 2)}\n`);
NODE

node "$ROOT_DIR/server/scripts/validate-extension-deps.js" --staging-dir "$STAGING_DIR"

# Pack using mcpb
echo "==> Packing extension..."
cd "$STAGING_DIR"
rm -f "$OUTPUT_FILE"
"$MCPB_BIN" pack . "$OUTPUT_FILE"

# Show results
echo ""
echo "==> Build complete!"
ls -lh "$OUTPUT_FILE"

echo "==> Cleaning up staging directories..."
