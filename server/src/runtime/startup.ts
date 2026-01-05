// @lifecycle canonical - Handles early startup diagnostics and rollback wiring.
/**
 * Server Root Detection and Startup Utilities
 * Robust server root directory detection for different execution contexts:
 * - Local development (node dist/index.js)
 * - Claude Desktop (absolute path invocation)
 * - Global npm install (npm install -g)
 * - npx execution (temporary install)
 * - Local npm install (node_modules/.bin/)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

interface DetectionStrategy {
  name: string;
  priority: 'high' | 'medium' | 'low';
  fn: () => Promise<string | null>;
}

interface ValidationResult {
  valid: boolean;
  missing: string[];
  root: string;
}

/**
 * Server Root Detector
 * Handles robust server root directory detection using multiple strategies
 * optimized for different execution contexts (npm install, Claude Desktop, development)
 */
export class ServerRootDetector {
  private isVerbose = false;
  private isQuiet = false;
  private hasWarnedEnvDeprecation = false;

  /**
   * Determine the server root directory using multiple strategies
   * Priority order:
   * 1. Package Resolution - Find package.json with matching name (npm installs)
   * 2. Script Entry Point - Resolve symlinks from process.argv[1]
   * 3. Module URL - Walk up from import.meta.url
   * 4. CWD Fallback - process.cwd() patterns (last resort)
   */
  async determineServerRoot(): Promise<string> {
    const args = process.argv.slice(2);
    this.isVerbose = args.includes('--verbose') || args.includes('--debug-startup');
    this.isQuiet = args.includes('--quiet');

    const strategies: DetectionStrategy[] = [
      {
        name: 'package-resolution',
        priority: 'high',
        fn: () => this.resolveFromPackage(),
      },
      {
        name: 'script-entry-point',
        priority: 'high',
        fn: () => this.resolveFromScriptPath(),
      },
      {
        name: 'module-url',
        priority: 'medium',
        fn: () => this.resolveFromModuleUrl(),
      },
      {
        name: 'cwd-fallback',
        priority: 'low',
        fn: () => this.resolveFromCwd(),
      },
    ];

    if (this.isVerbose) {
      this.logDiagnosticInfo();
    }

    for (const strategy of strategies) {
      try {
        const result = await strategy.fn();
        if (result) {
          const validation = await this.validateServerRoot(result);
          if (validation.valid) {
            if (this.isVerbose) {
              console.error(`✓ SUCCESS: ${strategy.name}`);
              console.error(`  Path: ${result}`);
              console.error(`  Priority: ${strategy.priority}`);
            }
            return result;
          } else if (this.isVerbose) {
            console.error(`⚠ PARTIAL: ${strategy.name} found ${result}`);
            console.error(`  Missing: ${validation.missing.join(', ')}`);
          }
        } else if (this.isVerbose) {
          console.error(`✗ SKIP: ${strategy.name} returned null`);
        }
      } catch (error) {
        if (this.isVerbose) {
          console.error(`✗ FAILED: ${strategy.name}`);
          console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    throw new Error(this.generateErrorMessage());
  }

  /**
   * Strategy 1: Package Resolution (Primary for npm installs)
   * Walks up from the current module to find package.json with matching name
   */
  private async resolveFromPackage(): Promise<string | null> {
    try {
      const __filename = fileURLToPath(import.meta.url);
      let dir = path.dirname(__filename);

      // Walk up to find package.json (max 5 levels for dist/runtime/startup.js)
      for (let i = 0; i < 5; i++) {
        const pkgPath = path.join(dir, 'package.json');
        try {
          const content = await fs.readFile(pkgPath, 'utf8');
          const pkg = JSON.parse(content);
          if (pkg.name === 'claude-prompts') {
            if (this.isVerbose) {
              console.error(`  Found package.json at: ${pkgPath}`);
              console.error(`  Package name matches: ${pkg.name}`);
            }
            return dir;
          }
        } catch {
          // Not found at this level, continue walking up
        }
        const parent = path.dirname(dir);
        if (parent === dir) break; // Reached filesystem root
        dir = parent;
      }
    } catch {
      // Strategy failed
    }
    return null;
  }

  /**
   * Strategy 2: Script Entry Point (Claude Desktop, direct node)
   * Resolves symlinks to find actual package location
   */
  private async resolveFromScriptPath(): Promise<string | null> {
    if (!process.argv[1]) return null;

    try {
      // Resolve symlinks to get actual file location
      // This handles: /usr/local/bin/claude-prompts -> actual package
      const realPath = await fs.realpath(process.argv[1]);
      const scriptDir = path.dirname(realPath);

      // Script is in dist/, go up one level to server root
      const serverRoot = path.dirname(scriptDir);

      if (this.isVerbose) {
        console.error(`  process.argv[1]: ${process.argv[1]}`);
        console.error(`  Resolved to: ${realPath}`);
        console.error(`  Server root: ${serverRoot}`);
      }

      // Validate config.json exists
      const configPath = path.join(serverRoot, 'config.json');
      await fs.access(configPath);
      return serverRoot;
    } catch {
      return null;
    }
  }

  /**
   * Strategy 3: Module URL Resolution
   * Uses import.meta.url to find package root
   */
  private async resolveFromModuleUrl(): Promise<string | null> {
    try {
      const __filename = fileURLToPath(import.meta.url);
      // startup.ts is at dist/runtime/startup.js
      // Need to go up 2 levels: runtime -> dist -> server root
      const serverRoot = path.resolve(path.dirname(__filename), '..', '..');

      if (this.isVerbose) {
        console.error(`  Module location: ${__filename}`);
        console.error(`  Resolved root: ${serverRoot}`);
      }

      const configPath = path.join(serverRoot, 'config.json');
      await fs.access(configPath);
      return serverRoot;
    } catch {
      return null;
    }
  }

  /**
   * Strategy 4: CWD Fallback (Last resort, development only)
   */
  private async resolveFromCwd(): Promise<string | null> {
    const candidates = [process.cwd(), path.join(process.cwd(), 'server')];

    for (const candidate of candidates) {
      try {
        const configPath = path.join(candidate, 'config.json');
        await fs.access(configPath);

        if (this.isVerbose) {
          console.error(`  Found via cwd: ${candidate}`);
        }
        return candidate;
      } catch {
        // Try next candidate
      }
    }

    return null;
  }

  /**
   * Validate that a directory is a valid server root
   * Checks for required files and directories
   */
  private async validateServerRoot(root: string): Promise<ValidationResult> {
    const missing: string[] = [];

    // config.json is always required
    try {
      await fs.access(path.join(root, 'config.json'));
    } catch {
      missing.push('config.json');
    }

    // Prompts: check resources/prompts (new structure) OR prompts (legacy)
    const hasResourcesPrompts = await this.pathExists(path.join(root, 'resources', 'prompts'));
    const hasLegacyPrompts = await this.pathExists(path.join(root, 'prompts'));
    if (!hasResourcesPrompts && !hasLegacyPrompts) {
      missing.push('prompts (or resources/prompts)');
    }

    // gates directory is optional (may be bundled differently in some deployments)
    // No need to check - it's not required for validation

    return {
      valid: missing.length === 0,
      missing,
      root,
    };
  }

  /**
   * Check if a path exists (file or directory)
   */
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Log diagnostic information for troubleshooting
   */
  private logDiagnosticInfo(): void {
    console.error('=== SERVER ROOT DETECTION ===');
    console.error(`process.cwd(): ${process.cwd()}`);
    console.error(`process.argv[0]: ${process.argv[0]}`);
    console.error(`process.argv[1]: ${process.argv[1] || 'undefined'}`);
    console.error(`import.meta.url: ${import.meta.url}`);
    console.error(`MCP_WORKSPACE: ${process.env['MCP_WORKSPACE'] || 'undefined'}`);
    console.error('');
  }

  /**
   * Generate actionable error message when all strategies fail
   */
  private generateErrorMessage(): string {
    return `
Unable to detect server root directory.

This usually happens when:
1. The package was not installed correctly
2. Required files are missing (config.json, resources/prompts/ or prompts/)
3. Running from an unexpected directory

SOLUTIONS:

If running from source:
  cd /path/to/claude-prompts-mcp/server
  node dist/index.js

If installed via npm:
  npm uninstall -g claude-prompts
  npm install -g claude-prompts

For Claude Desktop, ensure claude_desktop_config.json uses absolute paths:
  {
    "mcpServers": {
      "claude-prompts-mcp": {
        "command": "node",
        "args": ["/full/path/to/server/dist/index.js"]
      }
    }
  }

For debugging, run with --verbose flag to see detection details.
`;
  }
}
