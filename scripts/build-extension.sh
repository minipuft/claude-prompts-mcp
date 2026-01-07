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

# Create minimal package.json with only production deps (version from source)
cat > package.json << EOF
{
  "name": "claude-prompts",
  "version": "$VERSION",
  "type": "module",
  "main": "dist/index.js",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.18.1",
    "cors": "^2.8.5",
    "diff": "^8.0.2",
    "express": "^4.18.2",
    "js-yaml": "^4.1.1",
    "nunjucks": "^3.2.4",
    "zod": "^3.22.4"
  }
}
EOF

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
