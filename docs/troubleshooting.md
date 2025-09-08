# Troubleshooting Guide

This guide helps you diagnose and fix common issues with the Claude Prompts MCP Server.

## 🚨 Quick Fixes for Common Issues

### Server Won't Start

**Symptoms:**

- Server exits immediately after startup
- "Unable to determine server root directory" error
- Module not found errors

**Solutions:**

1. **Set Environment Variables (Recommended)**

   ```bash
   # Windows
   set MCP_SERVER_ROOT=E:\path\to\claude-prompts-mcp\server
   set MCP_PROMPTS_CONFIG_PATH=E:\path\to\claude-prompts-mcp\server\promptsConfig.json

   # macOS/Linux
   export MCP_SERVER_ROOT=/path/to/claude-prompts-mcp/server
   export MCP_PROMPTS_CONFIG_PATH=/path/to/claude-prompts-mcp/server/promptsConfig.json
   ```

2. **Use Absolute Paths in Claude Desktop Config**

   ```json
   {
     "mcpServers": {
       "claude-prompts-mcp": {
         "command": "node",
         "args": ["E:\\full\\path\\to\\server\\dist\\index.js"],
         "env": {
           "MCP_SERVER_ROOT": "E:\\full\\path\\to\\server",
           "MCP_PROMPTS_CONFIG_PATH": "E:\\full\\path\\to\\server\\promptsConfig.json"
         }
       }
     }
   }
   ```

3. **Check Working Directory**
   ```bash
   cd claude-prompts-mcp/server
   npm start
   ```

### Claude Desktop Can't Find the Server

**Symptoms:**

- Claude says MCP server is unavailable
- No prompts appear in Claude
- Connection timeout errors

**Diagnostic Steps:**

1. **Test Server Independently**

   ```bash
   cd server
   npm run build
   node dist/index.js --transport=stdio --verbose
   ```

2. **Check Claude Desktop Logs**

   - Windows: `%APPDATA%\Claude\logs\`
   - macOS: `~/Library/Logs/Claude/`
   - Look for MCP server errors

3. **Verify Configuration**

   ```bash
   # Check if config files exist
   ls -la config.json promptsConfig.json

   # Validate JSON syntax
   node -e "console.log(JSON.parse(require('fs').readFileSync('config.json')))"
   ```

### Prompts Not Loading

**Symptoms:**

- `>>listprompts` shows no results
- "No prompts loaded" in server logs
- Prompt files exist but aren't recognized

**Solutions:**

1. **Check Prompts Configuration**

   ```bash
   # Verify promptsConfig.json syntax
   node -e "console.log(JSON.parse(require('fs').readFileSync('promptsConfig.json')))"

   # Check category imports
   ls -la prompts/*/prompts.json
   ```

2. **Validate Prompt File Structure**

   ```bash
   # Check category-specific prompts.json files
   find prompts -name "prompts.json" -exec echo "=== {} ===" \; -exec cat {} \;
   ```

3. **Test Individual Categories**
   ```bash
   # Start with verbose logging
   npm start -- --verbose
   ```

### Hot-Reload Not Working

**Symptoms:**

- Changes to prompts don't appear without restart
- `>>reload_prompts` fails
- File watchers not triggering

**Solutions:**

1. **Manual Reload**

   ```bash
   >>reload_prompts reason="manual test"
   ```

2. **Check File Permissions**

   ```bash
   # Ensure files are writable
   ls -la prompts/*/prompts.json
   chmod 644 prompts/*/prompts.json
   ```

3. **Restart Server Process**
   ```bash
   # Full restart
   npm stop
   npm start
   ```

## 🔍 Diagnostic Tools

### Server Health Check

Run diagnostic commands to check server health:

```bash
# Check if server responds
curl http://localhost:9090/status

# Test MCP tools directly
echo '{"method": "listprompts", "params": {}}' | node dist/index.js --transport=stdio
```

### Verbose Logging

Enable detailed logging for troubleshooting:

```bash
# Start with maximum verbosity
npm start -- --verbose --debug-startup

# Or set log level in config.json
{
  "logging": {
    "level": "debug",
    "directory": "./logs"
  }
}
```

### Path Resolution Debugging

Use built-in path detection diagnostics:

```bash
# Test path detection strategies
node dist/index.js --verbose
```

The server will show detailed information about:

- Environment variables
- Working directory detection
- Config file resolution
- Prompt file loading

## 🐛 Common Error Messages

### "Unable to determine server root directory"

**Cause:** Path detection failed in Claude Desktop environment

**Fix:**

1. Set `MCP_SERVER_ROOT` environment variable
2. Use absolute paths in Claude Desktop config
3. Ensure working directory is correct

### "Prompts configuration file NOT FOUND"

**Cause:** promptsConfig.json path is incorrect

**Fix:**

1. Verify file exists: `ls -la promptsConfig.json`
2. Check file permissions

### "Error loading prompt: [filename]"

**Cause:** Invalid markdown format or missing sections

**Fix:**

1. Validate markdown syntax
2. Ensure required sections exist:
   - Title (# heading)
   - Description
   - User Message Template (## heading)
3. Check for special characters in filenames

### "Module not found" errors

**Cause:** Dependencies not installed or build incomplete

**Fix:**

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild project
npm run build
```

## 🔧 Advanced Troubleshooting

### Claude Desktop Integration Issues

**Problem:** Server works standalone but fails in Claude Desktop

**Investigation:**

1. **Environment Differences**

   ```bash
   # Compare environments
   node -e "console.log(process.env)" > standalone-env.json
   # Then check Claude Desktop logs for environment
   ```

2. **Working Directory Issues**

   ```javascript
   // Add to server startup for debugging
   console.log("Working directory:", process.cwd());
   console.log("Script location:", process.argv[1]);
   console.log("__dirname equivalent:", new URL(".", import.meta.url).pathname);
   ```

3. **Permission Problems**
   ```bash
   # Check if Claude Desktop can access files
   ls -la dist/index.js
   chmod +x dist/index.js
   ```

````

### Network and Transport Issues

**Problem:** SSE transport fails or connection drops

**Solutions:**

1. **Check Port Availability**

   ```bash
   netstat -an | grep 9090
   lsof -i :9090
````

2. **Test Different Transport**

   ```json
   {
     "transports": {
       "default": "stdio",
       "sse": { "enabled": false }
     }
   }
   ```

3. **Firewall Configuration**
   - Ensure port 9090 is open
   - Check antivirus software
   - Verify localhost access

## 🛠️ Development and Testing

### Running Tests

```bash
# Run test suite
npm test

# Run with coverage
npm run test:coverage

# Test specific modules
npm test -- --grep "PromptManager"
```

### Manual Testing Process

```bash
# 1. Clean build
npm run clean
npm run build

# 2. Test configuration loading
node -e "
const config = require('./dist/config/index.js');
const manager = new config.ConfigManager('./config.json');
manager.loadConfig().then(() => console.log('Config OK'));
"

# 3. Test prompt loading
node -e "
const prompts = require('./dist/prompts/index.js');
// Test prompt loading logic
"

# 4. Test MCP tools
echo '{"method": "listprompts", "params": {}}' | node dist/index.js --transport=stdio
```

### Creating Minimal Test Cases

For bug reports, create minimal reproduction:

```bash
# Minimal server setup
mkdir test-server
cd test-server
npm init -y
npm install @modelcontextprotocol/sdk

# Minimal config.json
echo '{
  "server": { "name": "test", "version": "1.0.0" },
  "prompts": { "file": "promptsConfig.json" }
}' > config.json

# Minimal promptsConfig.json
echo '{
  "categories": [{"id": "test", "name": "Test"}],
  "imports": ["prompts/test/prompts.json"]
}' > promptsConfig.json
```

## 📋 Collecting Debug Information

When reporting issues, include:

### System Information

```bash
# System details
node --version
npm --version
uname -a  # or systeminfo on Windows

# Project information
git rev-parse HEAD
npm list --depth=0
```

### Server Logs

```bash
# Capture server startup with full verbosity
npm start -- --verbose --debug-startup 2>&1 | tee server-debug.log
```

### Configuration Files

```bash
# Sanitize and share configs (remove sensitive data)
cat config.json
cat promptsConfig.json
find prompts -name "prompts.json" -exec echo "=== {} ===" \; -exec cat {} \;
```

### Claude Desktop Configuration

```json
// Share your claude_desktop_config.json (remove paths if needed)
{
  "mcpServers": {
    "claude-prompts-mcp": {
      // Your configuration here
    }
  }
}
```

## 🚀 Performance Optimization

### Startup Time Optimization

```bash
# Profile startup time
time npm start

# Optimize with environment variables
export MCP_SERVER_ROOT="/full/path/to/server"
export MCP_PROMPTS_CONFIG_PATH="/full/path/to/server/promptsConfig.json"
```

### Memory Usage Optimization

```javascript
// Monitor memory in config.json
{
  "logging": {
    "level": "info",
    "memoryMonitoring": true
  }
}
```

### Prompt Loading Optimization

- Keep prompt files reasonably sized (< 100KB each)
- Limit number of categories (< 20 for best performance)
- Use text references for very long content
- Avoid deeply nested category structures

## 🆘 Getting Help

If you're still experiencing issues:

1. **Search Existing Issues**: Check [GitHub Issues](https://github.com/minipuft/claude-prompts-mcp/issues)

2. **Create Detailed Bug Report**:

   - Include error messages and logs
   - Share your configuration (sanitized)
   - Provide reproduction steps
   - Include system information

3. **Join Community Discussions**: [GitHub Discussions](https://github.com/minipuft/claude-prompts-mcp/discussions)

4. **Emergency Debugging**: Use `--verbose --debug-startup` flags for maximum diagnostic output

Remember: Most issues are related to path resolution or configuration problems. Setting the environment variables `MCP_SERVER_ROOT` and `MCP_PROMPTS_CONFIG_PATH` solves 90% of setup issues! 🎯
