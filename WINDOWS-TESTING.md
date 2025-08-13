# Windows Container Testing Setup

This setup provides multiple approaches for testing Windows compatibility locally in a WSL2/Linux Docker environment.

## Available Methods

### Method 1: Native Windows Containers (if available)
```bash
# Only works if Docker is configured for Windows containers
docker pull mcr.microsoft.com/windows/nanoserver:ltsc2022
```

### Method 2: Node.js Windows Simulation
```bash
# Use Alpine Node.js images for lightweight Windows-compatible testing
./local-test.sh run code-quality --actrc .actrc.windows-enhanced
```

### Method 3: Cross-Platform Node.js Testing
```bash
# Test Node.js compatibility across platforms
node scripts/windows-tests/test-windows-paths.js
scripts/windows-tests/test-windows-startup.sh
```

### Method 4: Environment Simulation
```bash
# Load Windows-like environment variables
source .env.windows
```

### Method 5: Comprehensive Testing
```bash
# Run all platform tests
scripts/test-all-platforms.sh
```

## Usage Examples

### Quick Windows Simulation Test
```bash
# Test with Windows-like configuration
ACT_RC=.actrc.windows-enhanced ./local-test.sh dry-run code-quality
```

### Cross-Platform Build Test
```bash
# Test Node.js builds across platforms
docker run --rm -v "$PWD":/workspace -w /workspace/server node:18-alpine npm run build
docker run --rm -v "$PWD":/workspace -w /workspace/server node:18-windowsservercore npm run build
```

### Comprehensive CI Simulation
```bash
# Simulate full CI pipeline with all platforms
./scripts/test-all-platforms.sh
```

## Configuration Files

- `.actrc.windows-enhanced` - Enhanced Act configuration for Windows testing
- `.env.windows` - Windows environment simulation
- `scripts/windows-tests/` - Windows-specific test scripts
- `scripts/test-all-platforms.sh` - Comprehensive test runner

## Notes

- True Windows containers require Windows host or Docker Desktop Windows mode
- This setup provides the next best thing: cross-platform Node.js testing
- Environment simulation helps catch Windows-specific path and environment issues
- All tests are designed to work in WSL2/Linux Docker environments

## Troubleshooting

1. **Windows containers not available**: This is expected in WSL2. Use Node.js simulation instead.
2. **Path issues**: Use Node.js `path` module for cross-platform path handling.
3. **Environment variables**: Test with both Linux and Windows-style environment variables.
