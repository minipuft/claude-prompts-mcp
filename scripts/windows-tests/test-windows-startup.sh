#!/bin/bash
# Test Windows-like startup scenarios

echo "Testing Windows-compatible startup..."

# Simulate Windows environment
export RUNNER_OS=Windows
export PATH="/c/Windows/System32:$PATH"

# Test Node.js startup
cd server
echo "Testing Node.js startup in Windows-like environment..."
node --version
npm --version

# Test our application
echo "Testing MCP server startup..."
npm run help

echo "✅ Windows startup test completed"
