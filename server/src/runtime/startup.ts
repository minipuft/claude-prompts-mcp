/**
 * Server Root Detection and Startup Utilities
 * Robust server root directory detection for different execution contexts
 */

import path from "path";
import { fileURLToPath } from "url";

/**
 * Server Root Detector
 * Handles robust server root directory detection using multiple strategies
 * optimized for different execution contexts (direct execution vs Claude Desktop)
 */
export class ServerRootDetector {
  /**
   * Determine the server root directory using multiple strategies
   * This is more robust for different execution contexts (direct execution vs Claude Desktop)
   */
  async determineServerRoot(): Promise<string> {
    // Check for debug/verbose logging flags
    const args = process.argv.slice(2);
    const isVerbose =
      args.includes("--verbose") || args.includes("--debug-startup");
    const isQuiet = args.includes("--quiet");

    // Default to quiet mode (no output) unless verbose is specified
    const shouldShowOutput = isVerbose;

    // Early termination: If environment variable is set, use it immediately
    if (process.env.MCP_SERVER_ROOT) {
      const envPath = path.resolve(process.env.MCP_SERVER_ROOT);
      try {
        const configPath = path.join(envPath, "config.json");
        const fs = await import("fs/promises");
        await fs.access(configPath);

        if (shouldShowOutput) {
          console.error(`✓ SUCCESS: MCP_SERVER_ROOT environment variable`);
          console.error(`  Path: ${envPath}`);
          console.error(`  Config found: ${configPath}`);
        }
        return envPath;
      } catch (error) {
        if (isVerbose) {
          console.error(`✗ WARNING: MCP_SERVER_ROOT env var set but invalid`);
          console.error(`  Tried path: ${envPath}`);
          console.error(
            `  Error: ${error instanceof Error ? error.message : String(error)}`
          );
          console.error(`  Falling back to automatic detection...`);
        }
      }
    }

    // Build strategies in optimal order (most likely to succeed first)
    const strategies = this.buildDetectionStrategies();

    // Only show diagnostic information in verbose mode
    if (isVerbose) {
      this.logDiagnosticInfo(strategies);
    }

    // Test strategies with optimized flow
    return await this.testStrategies(strategies, isVerbose, shouldShowOutput);
  }


  /**
   * Build detection strategies in optimal order
   */
  private buildDetectionStrategies() {
    const strategies = [];

    // Strategy 1: process.argv[1] script location (most successful in Claude Desktop)
    if (process.argv[1]) {
      const scriptPath = process.argv[1];

      // Primary strategy: Direct script location to server root  
      strategies.push({
        name: "process.argv[1] script location",
        path: path.dirname(path.dirname(scriptPath)), // Go up from dist to server root
        source: `script: ${scriptPath}`,
        priority: "high",
      });
    }

    // Strategy 2: import.meta.url (current module location) - reliable fallback
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    strategies.push({
      name: "import.meta.url relative",
      path: path.join(__dirname, "..", ".."),
      source: `module: ${__filename}`,
      priority: "medium",
    });

    // Strategy 3: Common Claude Desktop patterns (ordered by likelihood)
    const commonPaths = [
      { path: path.join(process.cwd(), "server"), desc: "cwd/server" },
      { path: process.cwd(), desc: "cwd" },
      { path: path.join(process.cwd(), "..", "server"), desc: "parent/server" },
      { path: path.join(__dirname, "..", "..", ".."), desc: "module parent" },
    ];

    for (const { path: commonPath, desc } of commonPaths) {
      strategies.push({
        name: `common pattern (${desc})`,
        path: commonPath,
        source: `pattern: ${commonPath}`,
        priority: "low",
      });
    }

    return strategies;
  }

  /**
   * Log diagnostic information for troubleshooting
   */
  private logDiagnosticInfo(strategies: any[]) {
    console.error("=== SERVER ROOT DETECTION STRATEGIES ===");
    console.error(`Environment: process.cwd() = ${process.cwd()}`);
    console.error(`Environment: process.argv[0] = ${process.argv[0]}`);
    console.error(
      `Environment: process.argv[1] = ${process.argv[1] || "undefined"}`
    );
    console.error(
      `Environment: __filename = ${fileURLToPath(import.meta.url)}`
    );
    console.error(
      `Environment: MCP_SERVER_ROOT = ${
        process.env.MCP_SERVER_ROOT || "undefined"
      }`
    );
    console.error(`Strategies to test: ${strategies.length}`);
    console.error("");
  }

  /**
   * Test strategies with optimized flow
   */
  private async testStrategies(strategies: any[], isVerbose: boolean, shouldShowOutput: boolean): Promise<string> {
    let lastHighPriorityIndex = -1;
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      // Track where high-priority strategies end for early termination logic
      if (strategy.priority === "high") {
        lastHighPriorityIndex = i;
      }

      try {
        const resolvedPath = path.resolve(strategy.path);

        // Check if config.json exists in this location
        const configPath = path.join(resolvedPath, "config.json");
        const fs = await import("fs/promises");
        await fs.access(configPath);

        // Success! Only log in verbose mode
        if (shouldShowOutput) {
          console.error(`✓ SUCCESS: ${strategy.name}`);
          console.error(`  Path: ${resolvedPath}`);
          console.error(`  Source: ${strategy.source}`);
          console.error(`  Config found: ${configPath}`);

          // Show efficiency info in verbose mode
          if (isVerbose) {
            console.error(
              `  Strategy #${i + 1}/${strategies.length} (${
                strategy.priority
              } priority)`
            );
            console.error(
              `  Skipped ${strategies.length - i - 1} remaining strategies`
            );
          }
        }

        return resolvedPath;
      } catch (error) {
        // Only log failures in verbose mode
        if (isVerbose) {
          console.error(`✗ FAILED: ${strategy.name}`);
          console.error(`  Tried path: ${path.resolve(strategy.path)}`);
          console.error(`  Source: ${strategy.source}`);
          console.error(`  Priority: ${strategy.priority}`);
          console.error(
            `  Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Early termination: If all high-priority strategies fail and we're not in verbose mode,
        // provide a simplified error message encouraging environment variable usage
        if (
          i === lastHighPriorityIndex &&
          !isVerbose &&
          lastHighPriorityIndex >= 0
        ) {
          if (shouldShowOutput) {
            console.error(
              `⚠️  High-priority detection strategies failed. Trying fallback methods...`
            );
            console.error(
              `💡 Tip: Set MCP_SERVER_ROOT environment variable for guaranteed detection`
            );
            console.error(`📝 Use --verbose to see detailed strategy testing`);
          }
        }
      }
    }

    // If all strategies fail, provide optimized troubleshooting information
    const attemptedPaths = strategies
      .map(
        (s, i) =>
          `  ${i + 1}. ${s.name} (${s.priority}): ${path.resolve(s.path)}`
      )
      .join("\n");

    const troubleshootingInfo = this.generateTroubleshootingInfo(attemptedPaths);

    console.error(troubleshootingInfo);

    throw new Error(
      `Unable to auto-detect server root directory after testing ${strategies.length} strategies.\n\n` +
        `SOLUTION OPTIONS:\n` +
        `1. [RECOMMENDED] Set MCP_SERVER_ROOT environment variable for reliable detection\n` +
        `2. Ensure config.json is present in your server directory\n` +
        `3. Check file permissions and directory access\n\n` +
        `See detailed troubleshooting information above.`
    );
  }

  /**
   * Generate comprehensive troubleshooting information
   */
  private generateTroubleshootingInfo(attemptedPaths: string): string {
    return `
TROUBLESHOOTING CLAUDE DESKTOP ISSUES:

🎯 SOLUTION OPTIONS:

1. Set MCP_SERVER_ROOT environment variable (most reliable):
   Windows: set MCP_SERVER_ROOT=E:\\path\\to\\claude-prompts-mcp\\server
   macOS/Linux: export MCP_SERVER_ROOT=/path/to/claude-prompts-mcp/server

2. Verify file structure - ensure these files exist:
   • config.json (main server configuration)
   • prompts/ directory (with promptsConfig.json)
   • dist/ directory (compiled JavaScript)

3. Check file permissions and directory access

📁 Claude Desktop Configuration:
   Update your claude_desktop_config.json:
   {
     "mcpServers": {
       "claude-prompts-mcp": {
         "command": "node",
         "args": ["E:\\\\full\\\\path\\\\to\\\\server\\\\dist\\\\index.js", "--transport=stdio"],
         "env": {
           "MCP_SERVER_ROOT": "E:\\\\full\\\\path\\\\to\\\\server"
         }
       }
     }
   }

🔧 Alternative Solutions:
   1. Create wrapper script that sets working directory before launching server
   2. Use absolute paths in your Claude Desktop configuration
   3. Run from the correct working directory (server/)

🐛 Debug Mode:
   Use --verbose or --debug-startup flag to see detailed strategy testing

📊 Detection Summary:
   Current working directory: ${process.cwd()}
   Strategies tested (in order of priority):
${attemptedPaths}
`;
  }
}