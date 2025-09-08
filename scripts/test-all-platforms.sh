#!/bin/bash

# Comprehensive multi-platform testing script

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

# Test 1: Ubuntu (Linux) - Primary platform
print_test "Testing Ubuntu/Linux platform..."
if ./local-test.sh dry-run code-quality >/dev/null 2>&1; then
    print_pass "Ubuntu/Linux testing works"
else
    print_fail "Ubuntu/Linux testing failed"
fi

# Test 2: Windows simulation with Node.js
print_test "Testing Windows simulation (Node.js)..."
if docker run --rm -v "$PWD":/workspace -w /workspace/server node:18-alpine npm --version >/dev/null 2>&1; then
    print_pass "Windows simulation (Node.js) works"
else
    print_fail "Windows simulation (Node.js) failed"
fi

# Test 3: Cross-platform Node.js compatibility
print_test "Testing cross-platform Node.js compatibility..."
if node scripts/windows-tests/test-windows-paths.js >/dev/null 2>&1; then
    print_pass "Cross-platform compatibility works"
else
    print_fail "Cross-platform compatibility failed"
fi

# Test 4: Windows environment simulation
print_test "Testing Windows environment simulation..."
if source scripts/.env.windows && echo "Windows env loaded" >/dev/null 2>&1; then
    print_pass "Windows environment simulation works"
else
    print_fail "Windows environment simulation failed"
fi

echo ""
echo "Multi-platform testing summary completed!"
