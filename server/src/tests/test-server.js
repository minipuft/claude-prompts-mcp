#!/usr/bin/env node

/**
 * Simple test script to verify the MCP server is working correctly.
 * 
 * Usage:
 *   node test-server.js
 */

// Import required modules
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');
const path = require('path');
const fs = require('fs');

// Constants for paths and settings
const SERVER_DIR = __dirname;
const SERVER_BUILD_DIR = path.join(SERVER_DIR, 'dist');
const CONFIG_PATH = path.join(SERVER_DIR, 'config.json');
const TIMEOUT_MS = 15000; // 15 seconds timeout
const TEST_SUCCESS_TIMEOUT = 1000; // 1 second after successful logs before exiting

// ANSI color codes for console output
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

// Helper function for colored logging
function colorLog(color, message) {
  console.log(`${color}${message}${RESET}`);
}

// Helper function to validate JSON
function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

// Main test function
async function main() {
  // Check if the build directory exists
  if (!fs.existsSync(SERVER_BUILD_DIR)) {
    colorLog(RED, '❌ Build directory not found. Please run "npm run build" first.');
    process.exit(1);
  }
  
  // Check if config.json exists
  if (!fs.existsSync(CONFIG_PATH)) {
    colorLog(RED, '❌ Configuration file not found: config.json');
    process.exit(1);
  }
  
  // Parse config to see which transports are enabled
  let config;
  try {
    const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
    if (!isValidJSON(configData)) {
      colorLog(RED, '❌ Invalid JSON in config.json');
      process.exit(1);
    }
    config = JSON.parse(configData);
    colorLog(CYAN, '✅ Configuration file loaded successfully');
    
    // Log server information
    console.log(`
${CYAN}Server Information:${RESET}
- Name: ${config.server.name}
- Version: ${config.server.version}
- Port: ${config.server.port}
- STDIO Transport: ${config.transports.stdio?.enabled ? GREEN + 'Enabled' + RESET : YELLOW + 'Disabled' + RESET}
- SSE Transport: ${config.transports.sse?.enabled ? GREEN + 'Enabled' + RESET : YELLOW + 'Disabled' + RESET}
- Prompt Directory: ${config.prompts.directory}
`);
  } catch (error) {
    colorLog(RED, `❌ Error parsing config.json: ${error.message}`);
    process.exit(1);
  }
  
  // Start the server process
  colorLog(CYAN, '🚀 Starting server...');
  const server = spawn('node', ['dist/index.js'], { cwd: SERVER_DIR });
  
  // Handle server output
  let serverStarted = false;
  let stdioConfigured = false;
  let sseConfigured = false;
  let promptsLoaded = false;
  let errorOccurred = false;
  
  server.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    
    // Check for error messages
    if (output.includes('[ERROR]')) {
      errorOccurred = true;
      // If specific transport error, log it clearly
      if (output.includes('Failed to configure STDIO transport')) {
        colorLog(RED, '❌ STDIO transport configuration failed');
      }
      if (output.includes('Failed to configure SSE transport')) {
        colorLog(RED, '❌ SSE transport configuration failed');
      }
    }
    
    // Check for success messages
    if (output.includes('Server initialized successfully')) {
      colorLog(GREEN, '✅ Server initialized successfully');
      serverStarted = true;
    }
    
    // Check for prompt loading success
    if (output.includes('All prompts loaded successfully')) {
      colorLog(GREEN, '✅ Prompts loaded successfully');
      promptsLoaded = true;
    }
    
    // Check for transport configuration success
    if (output.includes('STDIO transport configured')) {
      colorLog(GREEN, '✅ STDIO transport configured successfully');
      stdioConfigured = true;
    }
    
    if (output.includes('SSE transport configured')) {
      colorLog(GREEN, '✅ SSE transport configured successfully');
      sseConfigured = true;
    }
    
    // If all required components are initialized, consider test successful
    if (serverStarted && promptsLoaded && 
        ((config.transports.stdio?.enabled && stdioConfigured) || !config.transports.stdio?.enabled) &&
        ((config.transports.sse?.enabled && sseConfigured) || !config.transports.sse?.enabled)) {
      
      // Give a short delay to allow for any pending errors to appear
      setTimeout(() => {
        if (!errorOccurred) {
          colorLog(GREEN, '🎉 Server started successfully with all configured transports!');
          server.kill();
          process.exit(0);
        }
      }, TEST_SUCCESS_TIMEOUT);
    }
  });
  
  server.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(output);
    errorOccurred = true;
  });
  
  server.on('close', (code) => {
    if (code !== 0 && !serverStarted) {
      colorLog(RED, `❌ Server process exited with code ${code}`);
      process.exit(1);
    }
  });
  
  // Set timeout to kill the server if it doesn't start in time
  setTimeout(() => {
    if (!serverStarted) {
      colorLog(RED, `❌ Server failed to start within ${TIMEOUT_MS / 1000} seconds`);
      server.kill();
      process.exit(1);
    } else if (config.transports.stdio?.enabled && !stdioConfigured) {
      colorLog(RED, '❌ STDIO transport was not configured within the timeout period');
      server.kill();
      process.exit(1);
    } else if (config.transports.sse?.enabled && !sseConfigured) {
      colorLog(RED, '❌ SSE transport was not configured within the timeout period');
      server.kill();
      process.exit(1);
    }
  }, TIMEOUT_MS);
}

// Run the main function
main().catch(error => {
  colorLog(RED, `❌ Unexpected error: ${error.message}`);
  process.exit(1);
}); 