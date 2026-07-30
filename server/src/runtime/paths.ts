// @lifecycle canonical - Centralized path resolution for all configuration assets.
/**
 * PathResolver - Unified Path Resolution System
 *
 * Provides centralized resolution of all configurable paths with a clear priority order:
 *   1. CLI flags (highest priority)
 *   2. MCP_*_PATH env vars (individual resource overrides)
 *   3. MCP_RESOURCES_PATH env var (unified resources base directory)
 *   4. MCP_WORKSPACE/resources (workspace subdirectory)
 *   5. Package defaults (lowest priority - npx fallback)
 *
 * Environment Variables:
 * - MCP_WORKSPACE: Full plugin/workspace directory (server/, hooks/, etc.)
 * - MCP_RESOURCES_PATH: Custom resources base directory (replaces package default)
 *
 * User Customization:
 * - Set MCP_RESOURCES_PATH to point to a directory with your custom resources
 * - The directory should contain subdirs: prompts/, gates/, frameworks/, etc.
 */

import { existsSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';

import type { ServerCliArgs } from './cli.js';

/**
 * CLI flag values parsed from command line arguments
 */
export interface PathResolverCliOptions {
  workspace?: string;
  config?: string;
}

/**
 * Configuration for PathResolver initialization
 */
export interface PathResolverConfig {
  /** CLI flag values (highest priority) */
  cli: PathResolverCliOptions;
  /** Package root directory (auto-detected) */
  packageRoot: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Resolved paths result
 */
export interface ResolvedPaths {
  workspace: string;
  resources: string;
  config: string;
  prompts: string;
  frameworks: string;
  gates: string;
  scripts: string;
  styles: string;
}

/**
 * PathResolver - Centralized path resolution for all MCP server assets
 *
 * @example
 * ```typescript
 * const resolver = new PathResolver({
 *   cli: { workspace: '/path/to/workspace' },
 *   packageRoot: '/path/to/package'
 * });
 *
 * const configPath = resolver.getConfigPath();
 * const promptsPath = resolver.getPromptsPath();
 * ```
 */
export class PathResolver {
  private config: PathResolverConfig;
  private cache: Partial<ResolvedPaths> = {};
  private debug: boolean;

  constructor(config: PathResolverConfig) {
    this.config = config;
    this.debug = config.debug ?? false;

    if (this.debug) {
      console.error('[PathResolver] Initialized with:');
      console.error(`  Package root: ${config.packageRoot}`);
      console.error(`  CLI options: ${JSON.stringify(config.cli)}`);
    }
  }

  /**
   * Get the workspace directory
   *
   * Priority:
   *   1. --workspace CLI flag
   *   2. MCP_WORKSPACE environment variable (user-defined or set by plugin hooks)
   *   3. Package root (default - npx fallback)
   */
  getWorkspace(): string {
    if (this.cache.workspace) return this.cache.workspace;

    let resolved: string;
    let source: string;

    // 1. CLI flag (highest priority)
    if (this.config.cli.workspace) {
      resolved = this.resolvePath(this.config.cli.workspace);
      source = 'CLI flag --workspace';
    }
    // 2. MCP_WORKSPACE environment variable (primary workspace config)
    else if (process.env['MCP_WORKSPACE']) {
      resolved = this.resolvePath(process.env['MCP_WORKSPACE']);
      source = 'MCP_WORKSPACE env var';
    }
    // 3. Package root (default - npx fallback)
    else {
      resolved = this.config.packageRoot;
      source = 'package root (default)';
    }

    this.cache.workspace = resolved;
    this.logResolution('workspace', resolved, source);
    return resolved;
  }

  /**
   * Get the resources base directory
   *
   * Priority:
   *   1. MCP_RESOURCES_PATH environment variable (user's custom resources)
   *   2. ${workspace}/resources (workspace subdirectory)
   *   3. ${packageRoot}/resources (default)
   *
   * This is used as the base for all resource types (prompts, gates, etc.)
   * unless individually overridden via MCP_*_PATH variables.
   */
  getResourcesPath(): string {
    if (this.cache.resources) return this.cache.resources;

    let resolved: string;
    let source: string;

    // 1. MCP_RESOURCES_PATH environment variable (user's custom resources location)
    if (process.env['MCP_RESOURCES_PATH']) {
      resolved = this.resolvePath(process.env['MCP_RESOURCES_PATH']);
      source = 'MCP_RESOURCES_PATH env var';
    }
    // 2. Workspace resources directory
    else {
      const workspace = this.getWorkspace();
      const workspaceResources = join(workspace, 'resources');

      if (existsSync(workspaceResources)) {
        resolved = workspaceResources;
        source = 'workspace resources/';
      } else {
        // 3. Package default
        resolved = join(this.config.packageRoot, 'resources');
        source = 'package resources/ (default)';
      }
    }

    this.cache.resources = resolved;
    this.logResolution('resources', resolved, source);
    return resolved;
  }

  /**
   * Get config.json path
   *
   * Priority:
   *   1. --config CLI flag
   *   2. MCP_CONFIG_PATH environment variable
   *   3. ${workspace}/config.json (if workspace differs from package and file exists)
   *   4. ${packageRoot}/config.json (default)
   */
  getConfigPath(): string {
    if (this.cache.config) return this.cache.config;

    let resolved: string;
    let source: string;

    // 1. CLI flag (highest priority)
    if (this.config.cli.config) {
      resolved = this.resolvePath(this.config.cli.config);
      source = 'CLI flag --config';
    }
    // 2. Environment variable
    else if (process.env['MCP_CONFIG_PATH']) {
      resolved = this.resolvePath(process.env['MCP_CONFIG_PATH']);
      source = 'MCP_CONFIG_PATH env var';
    }
    // 3. Workspace config.json (if different from package and exists)
    else {
      const workspace = this.getWorkspace();
      const workspaceConfig = join(workspace, 'config.json');

      if (workspace !== this.config.packageRoot && existsSync(workspaceConfig)) {
        resolved = workspaceConfig;
        source = 'workspace config.json';
      } else {
        // 4. Package default
        resolved = join(this.config.packageRoot, 'config.json');
        source = 'package config.json (default)';
      }
    }

    this.cache.config = resolved;
    this.logResolution('config', resolved, source);
    return resolved;
  }

  /**
   * Get prompts directory path
   *
   * Priority:
   *   1. ${resources}/prompts/ (from MCP_RESOURCES_PATH or workspace)
   *   2. ${workspace}/prompts/ (legacy, if exists)
   *   3. ${packageRoot}/resources/prompts/ (default)
   */
  getPromptsPath(): string {
    if (this.cache.prompts) return this.cache.prompts;
    const { resolved, source } = this.resolveResourceSubdir('prompts');
    this.cache.prompts = resolved;
    this.logResolution('prompts', resolved, source);
    return resolved;
  }

  /**
   * Get frameworks directory path
   *
   * Priority:
   *   1. ${resources}/frameworks/ (from MCP_RESOURCES_PATH or workspace)
   *   2. ${workspace}/frameworks/ (legacy, if exists)
   *   3. ${packageRoot}/resources/frameworks/ (default)
   */
  getMethodologiesPath(): string {
    if (this.cache.frameworks) return this.cache.frameworks;
    const { resolved, source } = this.resolveResourceSubdir('frameworks');
    this.cache.frameworks = resolved;
    this.logResolution('frameworks', resolved, source);
    return resolved;
  }

  /**
   * Get gates directory path
   *
   * Priority:
   *   1. ${resources}/gates/ (from MCP_RESOURCES_PATH or workspace)
   *   2. ${workspace}/gates/ (legacy, if exists)
   *   3. ${packageRoot}/resources/gates/ (default)
   */
  getGatesPath(): string {
    if (this.cache.gates) return this.cache.gates;
    const { resolved, source } = this.resolveResourceSubdir('gates');
    this.cache.gates = resolved;
    this.logResolution('gates', resolved, source);
    return resolved;
  }

  /**
   * Get scripts directory path
   *
   * Priority:
   *   1. ${resources}/scripts/ (from MCP_RESOURCES_PATH or workspace)
   *   2. ${workspace}/scripts/ (legacy, if exists)
   *   3. ${packageRoot}/resources/scripts/ (default)
   */
  getScriptsPath(): string {
    if (this.cache.scripts) return this.cache.scripts;
    const { resolved, source } = this.resolveResourceSubdir('scripts');
    this.cache.scripts = resolved;
    this.logResolution('scripts', resolved, source);
    return resolved;
  }

  /**
   * Get styles directory path
   *
   * Priority:
   *   1. ${resources}/styles/ (from MCP_RESOURCES_PATH or workspace)
   *   2. ${workspace}/styles/ (legacy, if exists)
   *   3. ${packageRoot}/resources/styles/ (default)
   */
  getStylesPath(): string {
    if (this.cache.styles) return this.cache.styles;
    const { resolved, source } = this.resolveResourceSubdir('styles');
    this.cache.styles = resolved;
    this.logResolution('styles', resolved, source);
    return resolved;
  }

  /**
   * Get all resolved paths at once
   */
  getAllPaths(): ResolvedPaths {
    return {
      workspace: this.getWorkspace(),
      resources: this.getResourcesPath(),
      config: this.getConfigPath(),
      prompts: this.getPromptsPath(),
      frameworks: this.getMethodologiesPath(),
      gates: this.getGatesPath(),
      scripts: this.getScriptsPath(),
      styles: this.getStylesPath(),
    };
  }

  /**
   * Get overlay resource directories derived from workspace.
   *
   * When MCP_WORKSPACE differs from package root, the workspace may contain
   * supplementary resources that overlay the shipped defaults. This is the
   * reusable pattern for all resource types (gates, frameworks, styles, etc.).
   *
   * Checks two conventions:
   *   - `${workspace}/${resourceType}/`           (e.g., ~/.claude/gates/)
   *   - `${workspace}/resources/${resourceType}/` (e.g., ~/.claude/resources/gates/)
   *
   * @param resourceType - Resource subdirectory name (gates, frameworks, styles, scripts)
   * @param primaryDir - Primary resource dir to exclude from results (dedup)
   * @returns Existing workspace-relative directories not matching primary
   */
  getOverlayResourceDirs(resourceType: string, primaryDir?: string): string[] {
    if (!this.isUsingCustomWorkspace()) return [];

    const workspace = this.getWorkspace();
    const candidates = [join(workspace, resourceType), join(workspace, 'resources', resourceType)];

    return candidates.filter((dir) => existsSync(dir) && dir !== primaryDir);
  }

  /**
   * Clear the resolution cache (useful for testing or hot-reload scenarios)
   */
  clearCache(): void {
    this.cache = {};
    if (this.debug) {
      console.error('[PathResolver] Cache cleared');
    }
  }

  /**
   * Get the package root directory
   */
  getPackageRoot(): string {
    return this.config.packageRoot;
  }

  /**
   * Check if a custom workspace is being used (different from package root)
   */
  isUsingCustomWorkspace(): boolean {
    return this.getWorkspace() !== this.config.packageRoot;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Resolve a path to absolute, handling relative paths
   */
  private resolvePath(inputPath: string): string {
    if (isAbsolute(inputPath)) {
      return inputPath;
    }
    // Resolve relative to current working directory
    return resolve(process.cwd(), inputPath);
  }

  /**
   * Resolve a resource subdirectory using the unified resolution chain:
   *   1. ${resources}/${subdir}/ (from MCP_RESOURCES_PATH or workspace)
   *   2. ${workspace}/${subdir}/ (legacy, if exists)
   *   3. ${packageRoot}/resources/${subdir}/ (default)
   */
  private resolveResourceSubdir(subdir: string): { resolved: string; source: string } {
    const resourcesBase = this.getResourcesPath();
    const resourcesDir = join(resourcesBase, subdir);

    if (existsSync(resourcesDir)) {
      return { resolved: resourcesDir, source: `resources/${subdir}/` };
    }

    const workspace = this.getWorkspace();
    const workspaceDir = join(workspace, subdir);
    if (existsSync(workspaceDir)) {
      return { resolved: workspaceDir, source: `workspace ${subdir}/ (legacy)` };
    }

    return {
      resolved: join(this.config.packageRoot, 'resources', subdir),
      source: `package resources/${subdir} (default)`,
    };
  }

  /**
   * Log resolution result if debug mode is enabled
   */
  private logResolution(name: string, resolved: string, source: string): void {
    if (this.debug) {
      console.error(`[PathResolver] ${name}: ${resolved}`);
      console.error(`  Source: ${source}`);
    }
  }
}

// ============================================================================
// CLI Argument Parsing Helpers
// ============================================================================

/**
 * Extract path-related options from pre-parsed CLI arguments.
 *
 * @param cliArgs - Pre-parsed server CLI arguments from cli.ts
 * @returns Path resolver options
 */
export function parsePathCliOptions(cliArgs: ServerCliArgs): PathResolverCliOptions {
  return {
    workspace: cliArgs.workspace,
    config: cliArgs.config,
  };
}

/**
 * Validate path CLI options
 *
 * @param options - Parsed CLI options
 * @returns Array of validation error messages (empty if valid)
 */
export function validatePathCliOptions(options: PathResolverCliOptions): string[] {
  const errors: string[] = [];

  if (options.workspace && !existsSync(options.workspace)) {
    errors.push(`Workspace directory does not exist: ${options.workspace}`);
  }

  if (options.config && !existsSync(options.config)) {
    errors.push(`Config file does not exist: ${options.config}`);
  }

  return errors;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a PathResolver instance from command line arguments
 *
 * @param args - Command line arguments
 * @param packageRoot - Package root directory
 * @param debug - Enable debug logging
 * @returns Configured PathResolver instance
 */
export function createPathResolver(
  cliArgs: ServerCliArgs,
  packageRoot: string,
  debug = false
): PathResolver {
  const cli = parsePathCliOptions(cliArgs);

  return new PathResolver({
    cli,
    packageRoot,
    debug,
  });
}
