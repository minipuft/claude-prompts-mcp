#!/bin/bash
# Validates that dist/index.js can be built and starts successfully
# Used in local development to verify build health

set -e

echo "Building bundled distribution..."
npm run build --silent

echo "Verifying startup..."
if timeout 5 node dist/index.js --startup-test 2>/dev/null; then
  echo "✅ Build successful and starts correctly"
else
  echo "❌ Build failed or startup test failed"
  exit 1
fi
