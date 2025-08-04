# Local GitHub Actions Testing Setup

This guide helps you set up Act for local GitHub Actions testing to speed up development and reduce cloud CI usage.

## Prerequisites

### 1. Install Act (✅ COMPLETED)
Act is already installed in this project. You can verify with:
```bash
~/.local/bin/act --version
```

### 2. Enable Docker Desktop WSL Integration (REQUIRED)

#### Option A: Docker Desktop (Recommended)
1. Open Docker Desktop
2. Go to **Settings** → **Resources** → **WSL Integration**
3. Enable **"Enable integration with my default WSL distro"**
4. Enable integration for your specific WSL distro (Ubuntu, etc.)
5. Click **Apply & Restart**

#### Option B: Alternative - Native Docker in WSL
If you prefer native Docker installation:
```bash
# Install Docker in WSL
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### 3. Test Docker Connectivity
After enabling WSL integration, test connectivity:
```bash
docker version
docker run hello-world
```

## Act Configuration

### Current Setup (✅ COMPLETED)
The project is configured with:
- **Platform mappings**: Ubuntu, Windows, macOS images
- **Environment variables**: NODE_ENV=test
- **Verbose logging**: For debugging
- **Docker socket**: Configured for WSL2

Configuration file: `.actrc`

## Usage Examples

### 1. List All Workflows
```bash
act --list
```

### 2. Run Specific Workflow (Dry Run)
```bash
act --dryrun -j code-quality
```

### 3. Run Workflow Locally
```bash
act -j code-quality
```

### 4. Test Specific Event
```bash
act pull_request
```

### 5. Run with Secrets
```bash
act --secret-file .env.secrets
```

## Available Workflows

Based on the current setup, you can test these workflows locally:

### Stage 0 (Independent Jobs)
- `code-quality` - Code Quality Checks
- `validate` - Validate Build and Tests  
- `enhanced-test-validation` - Enhanced Test Suite
- `mcp-protocol-validation` - MCP Protocol Compliance
- `cageerf-framework-validation` - CAGEERF Framework Validation
- `performance-baseline` - Performance Monitoring
- `cross-platform-compatibility` - Multi-Environment Testing
- `pr-quality-gates` - PR Validation

### Stage 1 (Dependent Jobs)
- `cageerf-integration` - CAGEERF Integration Tests (depends on validate)

## Common Issues & Solutions

### 1. Docker Connection Error
**Error**: `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`

**Solution**: Enable Docker Desktop WSL integration (see Prerequisites section)

### 2. Large Docker Images
**Issue**: Act downloads large Docker images

**Solution**: Use smaller images in `.actrc`:
```
-P ubuntu-latest=catthehacker/ubuntu:act-20.04
```

### 3. Missing Secrets
**Issue**: Workflows fail due to missing secrets

**Solution**: Create `.env.secrets` file or use `--secret` flag

### 4. Permission Issues
**Issue**: File permission problems in containers

**Solution**: Use `--user-ns` flag:
```bash
act --user-ns host
```

## Development Workflow

### Quick Testing Loop
1. **Make changes** to workflows
2. **Test locally** with Act:
   ```bash
   act --dryrun -j code-quality
   ```
3. **Run locally** if dry run passes:
   ```bash
   act -j code-quality
   ```
4. **Push to GitHub** when local tests pass

### Debugging Failed Workflows
1. **Run with verbose output**:
   ```bash
   act -j code-quality --verbose
   ```
2. **Check specific step**:
   ```bash
   act -j code-quality --matrix os:ubuntu-latest
   ```
3. **Interactive debugging**:
   ```bash
   act -j code-quality --shell
   ```

## Performance Tips

### 1. Use Local Cache
```bash
act --cache-image
```

### 2. Skip Docker Pull
```bash
act --pull=false
```

### 3. Reuse Containers
```bash
act --reuse
```

### 4. Parallel Execution
```bash
act --parallel
```

## Next Steps

1. **Enable Docker Desktop WSL Integration** (see Prerequisites)
2. **Test Docker connectivity**: `docker version`
3. **Run first local test**: `act --dryrun -j code-quality`
4. **Run actual workflow**: `act -j code-quality`
5. **Integrate into development workflow**

## Troubleshooting

If you encounter issues:

1. **Check Docker Desktop**: Ensure it's running and WSL integration is enabled
2. **Verify Act configuration**: `act --list` should show all workflows
3. **Test with dry run**: Always test with `--dryrun` first
4. **Check logs**: Use `--verbose` for detailed output
5. **Review documentation**: Visit [Act GitHub Repository](https://github.com/nektos/act)

## Status

- ✅ Act installed and configured
- ✅ Workflow parsing working
- ✅ Platform mappings configured
- ❌ Docker connectivity (requires WSL integration)
- ⏳ Ready for local testing once Docker is configured

---

*Act Local Testing Setup v1.0.0*
*Last Updated: 2025-07-18*