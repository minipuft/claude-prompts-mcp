#!/bin/bash
# Build Claude Desktop Extension (.mcpb) with production deps only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
STAGING_DIR="$ROOT_DIR/.mcpb-staging"
OUTPUT_FILE="$ROOT_DIR/claude-prompts.mcpb"

echo "==> Building Claude Desktop Extension"

# Clean staging directory
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

# Install production dependencies only
echo "==> Installing production dependencies..."
cd "$STAGING_DIR/server"

# Read version from server/package.json
VERSION=$(node -p "require('$ROOT_DIR/server/package.json').version")
echo "    Version: $VERSION"

# Create minimal package.json with production deps read dynamically from server/package.json
# NOTE: These deps are safety net for CJS interop - most are bundled in dist/index.js
# SSOT: server/package.json is the source of truth; deps are filtered at build time
echo "==> Generating package.json from server/package.json..."

# Read deps dynamically, excluding packages that are bundled inline by esbuild
DEPS=$(node -p "
  const pkg = require('$ROOT_DIR/server/package.json');
  // Packages bundled inline by esbuild - don't need as runtime deps
  const exclude = ['chokidar'];
  Object.entries(pkg.dependencies)
    .filter(([name]) => exclude.includes(name) === false && name.startsWith('@types/') === false)
    .map(([name, ver]) => '    \"' + name + '\": \"' + ver + '\"')
    .join(',\n');
")

cat > package.json << EOF
{
  "name": "claude-prompts",
  "version": "$VERSION",
  "type": "module",
  "main": "dist/index.js",
  "dependencies": {
$DEPS
  }
}
EOF

echo "    Dependencies:"
echo "$DEPS" | sed 's/^/      /'

npm install --omit=dev --ignore-scripts

# Pack using mcpb
echo "==> Packing extension..."
cd "$STAGING_DIR"
rm -f "$OUTPUT_FILE"
npx @anthropic-ai/mcpb pack . "$OUTPUT_FILE"

# Show results
echo ""
echo "==> Build complete!"
ls -lh "$OUTPUT_FILE"

# Cleanup
echo "==> Cleaning up staging directory..."
rm -rf "$STAGING_DIR"
