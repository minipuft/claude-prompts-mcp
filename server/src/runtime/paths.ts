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
 * - MCP_RESOURCES_PATH: Just the resources directory (prompts/, gates/, etc.)
 * - MCP_*_PATH: Individual resource overrides (MCP_PROMPTS_PATH, etc.)
 *
 * User Customization:
 * - Set MCP_RESOURCES_PATH to point to a directory with your custom resources
 * - The directory should contain subdirs: prompts/, gates/, methodologies/, etc.
 */

import { existsSync, readdirSync } from 'fs';
import { dirname, join, resolve, isAbsolute } from 'path';

/**
 * CLI flag values parsed from command line arguments
 */
export interface PathResolverCliOptions {
  workspace?: string;
  config?: string;
  prompts?: string;
  methodologies?: string;
  gates?: string;
  scripts?: string;
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
  methodologies: string;
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
   *   1. --prompts CLI flag
   *   2. MCP_PROMPTS_PATH environment variable
   *   3. ${resources}/prompts/ (from MCP_RESOURCES_PATH or workspace)
   *   4. ${workspace}/prompts/ (legacy, if exists)
   *   5. ${packageRoot}/resources/prompts/ (default)
   */
  getPromptsPath(): string {
    if (this.cache.prompts) return this.cache.prompts;

    let resolved: string;
    let source: string;

    // 1. CLI flag (highest priority)
    if (this.config.cli.prompts) {
      resolved = this.resolvePath(this.config.cli.prompts);
      source = 'CLI flag --prompts';
    }
    // 2. Individual environment variable
    else if (process.env['MCP_PROMPTS_PATH']) {
      resolved = this.resolvePath(process.env['MCP_PROMPTS_PATH']);
      source = 'MCP_PROMPTS_PATH env var';
    }
    // 3. Resources base + prompts/
    else {
      const resourcesBase = this.getResourcesPath();
      const resourcesPrompts = join(resourcesBase, 'prompts');
      const workspace = this.getWorkspace();
      const workspacePrompts = join(workspace, 'prompts');

      if (existsSync(resourcesPrompts)) {
        resolved = resourcesPrompts;
        source = 'resources/prompts/';
      } else if (existsSync(workspacePrompts)) {
        // 4. Legacy workspace prompts
        resolved = workspacePrompts;
        source = 'workspace prompts/ (legacy)';
      } else {
        // 5. Package default
        resolved = join(this.config.packageRoot, 'resources', 'prompts');
        source = 'package resources/prompts (default)';
      }
    }

    this.cache.prompts = resolved;
    this.logResolution('prompts', resolved, source);
    return resolved;
  }

  /**
   * Get methodologies directory path
   *
   * Priority:
   *   1. --methodologies CLI flag
   *   2. MCP_METHODOLOGIES_PATH environment variable
   *   3. ${resources}/methodologies (from MCP_RESOURCES_PATH or workspace)
   *   4. ${workspace}/methodologies (legacy, if exists)
   *   5. ${packageRoot}/resources/methodologies (default)
   */
  getMethodologiesPath(): string {
    if (this.cache.methodologies) return this.cache.methodologies;

    let resolved: string;
    let source: string;

    // 1. CLI flag (highest priority)
    if (this.config.cli.methodologies) {
      resolved = this.resolvePath(this.config.cli.methodologies);
      source = 'CLI flag --methodologies';
    }
    // 2. Individual environment variable
    else if (process.env['MCP_METHODOLOGIES_PATH']) {
      resolved = this.resolvePath(process.env['MCP_METHODOLOGIES_PATH']);
      source = 'MCP_METHODOLOGIES_PATH env var';
    }
    // 3. Resources base + methodologies/
    else {
      const resourcesBase = this.getResourcesPath();
      const resourcesMethodologies = join(resourcesBase, 'methodologies');
      const workspace = this.getWorkspace();
      const workspaceMethodologies = join(workspace, 'methodologies');

      if (existsSync(resourcesMethodologies) && this.hasMethodologyFiles(resourcesMethodologies)) {
        resolved = resourcesMethodologies;
        source = 'resources/methodologies/';
      } else if (
        existsSync(workspaceMethodologies) &&
        this.hasMethodologyFiles(workspaceMethodologies)
      ) {
        // 4. Legacy workspace methodologies
        resolved = workspaceMethodologies;
        source = 'workspace methodologies/ (legacy)';
      } else {
        // 5. Package default
        resolved = join(this.config.packageRoot, 'resources', 'methodologies');
        source = 'package resources/methodologies (default)';
      }
    }

    this.cache.methodologies = resolved;
    this.logResolution('methodologies', resolved, source);
    return resolved;
  }

  /**
   * Get gates directory path
   *
   * Priority:
   *   1. --gates CLI flag
   *   2. MCP_GATES_PATH environment variable
   *   3. ${resources}/gates (from MCP_RESOURCES_PATH or workspace)
   *   4. ${workspace}/gates (legacy, if exists)
   *   5. ${packageRoot}/resources/gates (default)
   */
  getGatesPath(): string {
    if (this.cache.gates) return this.cache.gates;

    let resolved: string;
    let source: string;

    // 1. CLI flag (highest priority)
    if (this.config.cli.gates) {
      resolved = this.resolvePath(this.config.cli.gates);
      source = 'CLI flag --gates';
    }
    // 2. Individual environment variable
    else if (process.env['MCP_GATES_PATH']) {
      resolved = this.resolvePath(process.env['MCP_GATES_PATH']);
      source = 'MCP_GATES_PATH env var';
    }
    // 3. Resources base + gates/
    else {
      const resourcesBase = this.getResourcesPath();
      const resourcesGates = join(resourcesBase, 'gates');
      const workspace = this.getWorkspace();
      const workspaceGates = join(workspace, 'gates');

      if (existsSync(resourcesGates) && this.hasGateFiles(resourcesGates)) {
        resolved = resourcesGates;
        source = 'resources/gates/';
      } else if (existsSync(workspaceGates) && this.hasGateFiles(workspaceGates)) {
        // 4. Legacy workspace gates
        resolved = workspaceGates;
        source = 'workspace gates/ (legacy)';
      } else {
        // 5. Package default
        resolved = join(this.config.packageRoot, 'resources', 'gates');
        source = 'package resources/gates (default)';
      }
    }

    this.cache.gates = resolved;
    this.logResolution('gates', resolved, source);
    return resolved;
  }

  /**
   * Get scripts directory path
   *
   * Priority:
   *   1. --scripts CLI flag
   *   2. MCP_SCRIPTS_PATH environment variable
   *   3. ${resources}/scripts (from MCP_RESOURCES_PATH or workspace)
   *   4. ${workspace}/scripts (legacy, if exists)
   *   5. ${packageRoot}/resources/scripts (default)
   */
  getScriptsPath(): string {
    if (this.cache.scripts) return this.cache.scripts;

    let resolved: string;
    let source: string;

    // 1. CLI flag (highest priority)
    if (this.config.cli.scripts) {
      resolved = this.resolvePath(this.config.cli.scripts);
      source = 'CLI flag --scripts';
    }
    // 2. Individual environment variable
    else if (process.env['MCP_SCRIPTS_PATH']) {
      resolved = this.resolvePath(process.env['MCP_SCRIPTS_PATH']);
      source = 'MCP_SCRIPTS_PATH env var';
    }
    // 3. Resources base + scripts/
    else {
      const resourcesBase = this.getResourcesPath();
      const resourcesScripts = join(resourcesBase, 'scripts');
      const workspace = this.getWorkspace();
      const workspaceScripts = join(workspace, 'scripts');

      if (existsSync(resourcesScripts) && this.hasScriptFiles(resourcesScripts)) {
        resolved = resourcesScripts;
        source = 'resources/scripts/';
      } else if (existsSync(workspaceScripts) && this.hasScriptFiles(workspaceScripts)) {
        // 4. Legacy workspace scripts
        resolved = workspaceScripts;
        source = 'workspace scripts/ (legacy)';
      } else {
        // 5. Package default
        resolved = join(this.config.packageRoot, 'resources', 'scripts');
        source = 'package resources/scripts (default)';
      }
    }

    this.cache.scripts = resolved;
    this.logResolution('scripts', resolved, source);
    return resolved;
  }

  /**
   * Get styles directory path
   *
   * Priority:
   *   1. MCP_STYLES_PATH environment variable
   *   2. ${resources}/styles (from MCP_RESOURCES_PATH or workspace)
   *   3. ${workspace}/styles (legacy, if exists)
   *   4. ${packageRoot}/resources/styles (default)
   */
  getStylesPath(): string {
    if (this.cache.styles) return this.cache.styles;

    let resolved: string;
    let source: string;

    // 1. Individual environment variable
    if (process.env['MCP_STYLES_PATH']) {
      resolved = this.resolvePath(process.env['MCP_STYLES_PATH']);
      source = 'MCP_STYLES_PATH env var';
    }
    // 2. Resources base + styles/
    else {
      const resourcesBase = this.getResourcesPath();
      const resourcesStyles = join(resourcesBase, 'styles');
      const workspace = this.getWorkspace();
      const workspaceStyles = join(workspace, 'styles');

      if (existsSync(resourcesStyles)) {
        resolved = resourcesStyles;
        source = 'resources/styles/';
      } else if (existsSync(workspaceStyles)) {
        // 3. Legacy workspace styles
        resolved = workspaceStyles;
        source = 'workspace styles/ (legacy)';
      } else {
        // 4. Package default
        resolved = join(this.config.packageRoot, 'resources', 'styles');
        source = 'package resources/styles (default)';
      }
    }

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
      methodologies: this.getMethodologiesPath(),
      gates: this.getGatesPath(),
      scripts: this.getScriptsPath(),
      styles: this.getStylesPath(),
    };
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
   * Check if a directory contains valid methodology files
   * (subdirectories with methodology.yaml)
   */
  private hasMethodologyFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return entries.some((entry) => {
        if (!entry.isDirectory()) return false;
        const yamlPath = join(dirPath, entry.name, 'methodology.yaml');
        return existsSync(yamlPath);
      });
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory contains valid gate files
   * (subdirectories with gate.yaml/gate.json or flat .json files)
   */
  private hasGateFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return entries.some((entry) => {
        if (entry.isDirectory()) {
          const yamlPath = join(dirPath, entry.name, 'gate.yaml');
          const jsonPath = join(dirPath, entry.name, 'gate.json');
          return existsSync(yamlPath) || existsSync(jsonPath);
        }
        return entry.isFile() && entry.name.endsWith('.json');
      });
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory contains valid script files
   * (subdirectories with tool.yaml)
   */
  private hasScriptFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return entries.some((entry) => {
        if (!entry.isDirectory()) return false;
        const toolYamlPath = join(dirPath, entry.name, 'tool.yaml');
        return existsSync(toolYamlPath);
      });
    } catch {
      return false;
    }
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
 * Parse path-related CLI flags from command line arguments
 *
 * Supported flags:
 *   --workspace=/path
 *   --config=/path
 *   --prompts=/path
 *   --methodologies=/path
 *   --gates=/path
 *   --scripts=/path
 *
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @returns Parsed CLI options
 */
export function parsePathCliOptions(args: string[]): PathResolverCliOptions {
  const options: PathResolverCliOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--workspace=')) {
      options.workspace = arg.slice('--workspace='.length);
    } else if (arg.startsWith('--config=')) {
      options.config = arg.slice('--config='.length);
    } else if (arg.startsWith('--prompts=')) {
      options.prompts = arg.slice('--prompts='.length);
    } else if (arg.startsWith('--methodologies=')) {
      options.methodologies = arg.slice('--methodologies='.length);
    } else if (arg.startsWith('--gates=')) {
      options.gates = arg.slice('--gates='.length);
    } else if (arg.startsWith('--scripts=')) {
      options.scripts = arg.slice('--scripts='.length);
    }
  }

  return options;
}

/**
 * Validate path CLI options
 *
 * @param options - Parsed CLI options
 * @returns Array of validation error messages (empty if valid)
 */
export function validatePathCliOptions(options: PathResolverCliOptions): string[] {
  const errors: string[] = [];

  // Validate paths exist if specified
  if (options.workspace && !existsSync(options.workspace)) {
    errors.push(`Workspace directory does not exist: ${options.workspace}`);
  }

  if (options.config && !existsSync(options.config)) {
    errors.push(`Config file does not exist: ${options.config}`);
  }

  if (options.prompts && !existsSync(options.prompts)) {
    errors.push(`Prompts file does not exist: ${options.prompts}`);
  }

  if (options.methodologies && !existsSync(options.methodologies)) {
    errors.push(`Methodologies directory does not exist: ${options.methodologies}`);
  }

  if (options.gates && !existsSync(options.gates)) {
    errors.push(`Gates directory does not exist: ${options.gates}`);
  }

  if (options.scripts && !existsSync(options.scripts)) {
    errors.push(`Scripts directory does not exist: ${options.scripts}`);
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
  args: string[],
  packageRoot: string,
  debug = false
): PathResolver {
  const cli = parsePathCliOptions(args);

  return new PathResolver({
    cli,
    packageRoot,
    debug,
  });
}
