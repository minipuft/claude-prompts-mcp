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
 * - MCP_RUNTIME_ROOT: Writable directory for state and logs
 * - MCP_RESOURCES_PATH: Custom resources base directory (replaces package default)
 *
 * User Customization:
 * - Set MCP_RESOURCES_PATH to point to a directory with your custom resources
 * - The directory should contain subdirs: prompts/, gates/, frameworks/, etc.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';

import type { ServerCliArgs } from './cli.js';

import {
  assertUsableDirectorySetting,
  describeRemoval,
  formatPathSettingRefusal,
  PathSettingError,
  resolveSettingPath,
  type PathFallback,
  type PathSetting,
} from '#shared/utils/path-setting.js';

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
  runtimeRoot: string;
  runtimeState: string;
  resources: string;
  config: string;
  prompts: string;
  frameworks: string;
  gates: string;
  scripts: string;
  styles: string;
  logs: string;
}

/** An operator-named config path and the flag or variable that named it. */
type ExplicitConfigSource = PathSetting & { name: '--config' | 'MCP_CONFIG_PATH' };

/** A workspace path and the flag or variable that named it. */
type WorkspaceSource = PathSetting & { name: '--workspace' | 'MCP_WORKSPACE' };

/**
 * Why `resolved` cannot serve as a config file, or `undefined` when it can.
 *
 * Reads the file: "exists" is not the property that matters, "parses into a config object" is.
 */
function describeUnusableConfigFile(resolved: string): string | undefined {
  try {
    if (statSync(resolved).isDirectory()) return 'is a directory, not a file';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'does not exist';
    return `cannot be read (${code ?? String(error)})`;
  }

  let content: string;
  try {
    content = readFileSync(resolved, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return `cannot be read (${code ?? String(error)})`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return `is not valid JSON (${error instanceof Error ? error.message : String(error)})`;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'is valid JSON but not a JSON object';
  }
  return undefined;
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

  /** Resolve the writable root independently from package-owned resources. */
  getRuntimeRoot(): string {
    if (this.cache.runtimeRoot !== undefined) return this.cache.runtimeRoot;

    const configured = process.env['MCP_RUNTIME_ROOT'];
    const hasConfiguredRoot = configured !== undefined && configured.trim() !== '';
    const resolved = hasConfiguredRoot ? this.resolvePath(configured) : this.getWorkspace();
    this.cache.runtimeRoot = resolved;
    this.logResolution(
      'runtime root',
      resolved,
      hasConfiguredRoot ? 'MCP_RUNTIME_ROOT env var' : 'effective workspace'
    );
    return resolved;
  }

  /** Directory containing SQLite and other mutable runtime state. */
  getRuntimeStatePath(): string {
    this.cache.runtimeState ??= join(this.getRuntimeRoot(), 'runtime-state');
    return this.cache.runtimeState;
  }

  /** The server's SQLite database — the one path every `SqliteEngine.getInstance` call names. */
  getStateDatabasePath(): string {
    return join(this.getRuntimeStatePath(), 'state.db');
  }

  /** Resolve a configured log directory beneath the writable runtime root. */
  getLogsPath(configuredDirectory = './logs'): string {
    if (isAbsolute(configuredDirectory)) return configuredDirectory;
    this.cache.logs ??= resolve(this.getRuntimeRoot(), configuredDirectory);
    return this.cache.logs;
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
    // 2. Workspace resources directory, else 3. package default
    else {
      ({ resolved, source } = this.resolveDefaultResourcesPath());
    }

    this.cache.resources = resolved;
    this.logResolution('resources', resolved, source);
    return resolved;
  }

  /** Where resources resolve when `MCP_RESOURCES_PATH` names nothing: the workspace's, else the package's. */
  private resolveDefaultResourcesPath(): { resolved: string; source: string } {
    const workspaceResources = join(this.getWorkspace(), 'resources');
    if (existsSync(workspaceResources)) {
      return { resolved: workspaceResources, source: 'workspace resources/' };
    }
    return {
      resolved: join(this.config.packageRoot, 'resources'),
      source: 'package resources/ (default)',
    };
  }

  /**
   * Refuse startup on an operator path setting the server cannot use, before anything reads,
   * watches or creates a path beneath it. Throws `PathSettingError`.
   *
   * Checked once here rather than inside the getters: a getter answers "where would this resolve",
   * which tests and tooling ask of paths that need not exist, while this answers "can the server
   * start on what it was given". Before it, none of the three failed loudly: the logs `mkdir`
   * created a missing workspace, a missing resources path fell through to the bundled catalog one
   * subfolder at a time, and a malformed workspace config.json booted on built-in defaults.
   *
   * The workspace goes first because it decides both the resources fallback and the default config.
   * An empty value counts as unset, as it does in the getters, and a workspace with no config.json
   * still uses the packaged one.
   */
  assertUsablePathSettings(): void {
    const workspace = this.readWorkspaceSource();
    if (workspace !== undefined) {
      assertUsableDirectorySetting(workspace, {
        fallback: this.describeWorkspaceFallback(workspace),
      });
    }

    const resources = process.env['MCP_RESOURCES_PATH'];
    if (resources !== undefined && resources !== '') {
      const { resolved, source } = this.resolveDefaultResourcesPath();
      // With no custom workspace the "workspace" resources ARE the package's, so say so.
      const label =
        source === 'workspace resources/' && this.isUsingCustomWorkspace()
          ? 'the workspace resources'
          : 'the packaged resources';
      assertUsableDirectorySetting(
        { name: 'MCP_RESOURCES_PATH', value: resources },
        { fallback: { label, resolved } }
      );
    }

    this.getConfigPath();
    if (workspace !== undefined && this.readExplicitConfigSource() === undefined) {
      this.assertUsableWorkspaceConfig(workspace);
    }
  }

  /** The workspace path, flag before variable; an empty value counts as unset. */
  private readWorkspaceSource(): WorkspaceSource | undefined {
    const fromFlag = this.config.cli.workspace;
    if (fromFlag !== undefined && fromFlag !== '') return { name: '--workspace', value: fromFlag };
    const fromEnv = process.env['MCP_WORKSPACE'];
    if (fromEnv !== undefined && fromEnv !== '') return { name: 'MCP_WORKSPACE', value: fromEnv };
    return undefined;
  }

  /** What removing a workspace setting falls back to: the variable behind the flag, else the package root. */
  private describeWorkspaceFallback(workspace: WorkspaceSource): PathFallback {
    const fromEnv = process.env['MCP_WORKSPACE'];
    if (workspace.name === '--workspace' && fromEnv !== undefined && fromEnv !== '') {
      return { label: 'the MCP_WORKSPACE workspace', resolved: resolveSettingPath(fromEnv) };
    }
    return { label: 'the package root', resolved: this.config.packageRoot };
  }

  /** A config.json the workspace holds must be usable; one it does not hold falls back to the packaged config. */
  private assertUsableWorkspaceConfig(workspace: WorkspaceSource): void {
    const { resolved, source } = this.resolveDefaultConfigPath();
    if (source !== 'workspace config.json') return;
    const problem = describeUnusableConfigFile(resolved);
    if (problem === undefined) return;
    throw new PathSettingError(
      formatPathSettingRefusal({
        setting: workspace,
        resolved: this.getWorkspace(),
        problem,
        subject: `config file ${resolved}`,
        expected: 'a readable JSON config file',
        remedy: `move it out of the workspace to use the packaged default at ${join(this.config.packageRoot, 'config.json')}`,
      })
    );
  }

  /**
   * Get config.json path
   *
   * Priority:
   *   1. --config CLI flag
   *   2. MCP_CONFIG_PATH environment variable
   *   3. ${workspace}/config.json (if workspace differs from package and file exists)
   *   4. ${packageRoot}/config.json (default)
   *
   * An explicit path (1 or 2) that is not a readable JSON config file throws `PathSettingError`.
   * `ConfigLoader.loadConfig` answers an unreadable file with the built-in defaults, which is a
   * sensible floor for the package's own file and the wrong answer for a path an operator named:
   * the server booted, served the bundled catalog, and never used the settings asked for.
   */
  getConfigPath(): string {
    if (this.cache.config) return this.cache.config;

    let resolved: string;
    let source: string;
    const explicit = this.readExplicitConfigSource();

    if (explicit !== undefined) {
      resolved = this.resolvePath(explicit.value);
      source = explicit.name === '--config' ? 'CLI flag --config' : 'MCP_CONFIG_PATH env var';
      const problem = describeUnusableConfigFile(resolved);
      if (problem !== undefined) {
        throw new PathSettingError(
          formatPathSettingRefusal({
            setting: explicit,
            resolved,
            problem,
            expected: 'a readable JSON config file',
            remedy: describeRemoval(explicit, this.describeDefaultConfigFallback()),
          })
        );
      }
    } else {
      ({ resolved, source } = this.resolveDefaultConfigPath());
    }

    this.cache.config = resolved;
    this.logResolution('config', resolved, source);
    return resolved;
  }

  /** The explicit config path, flag before variable; an empty value counts as unset. */
  private readExplicitConfigSource(): ExplicitConfigSource | undefined {
    const fromFlag = this.config.cli.config;
    if (fromFlag !== undefined && fromFlag !== '') return { name: '--config', value: fromFlag };
    const fromEnv = process.env['MCP_CONFIG_PATH'];
    if (fromEnv !== undefined && fromEnv !== '') return { name: 'MCP_CONFIG_PATH', value: fromEnv };
    return undefined;
  }

  /** The config an explicit path's removal falls back to, with a caveat when that file is unusable too. */
  private describeDefaultConfigFallback(): PathFallback {
    const { resolved, source } = this.resolveDefaultConfigPath();
    if (source !== 'workspace config.json') return { label: 'the packaged default', resolved };
    const caveat = describeUnusableConfigFile(resolved);
    return { label: 'the workspace config', resolved, ...(caveat !== undefined && { caveat }) };
  }

  /** Where config resolves when nothing names a path: the workspace file if present, else the package's. */
  private resolveDefaultConfigPath(): { resolved: string; source: string } {
    const workspace = this.getWorkspace();
    const workspaceConfig = join(workspace, 'config.json');

    if (workspace !== this.config.packageRoot && existsSync(workspaceConfig)) {
      return { resolved: workspaceConfig, source: 'workspace config.json' };
    }
    return {
      resolved: join(this.config.packageRoot, 'config.json'),
      source: 'package config.json (default)',
    };
  }

  /**
   * Get prompts directory path: where prompts are read from first, and where a write to them lands.
   * Resolution order: `resolveResourceSubdir`.
   */
  getPromptsPath(): string {
    if (this.cache.prompts) return this.cache.prompts;
    const { resolved, source } = this.resolveResourceSubdir('prompts');
    this.cache.prompts = resolved;
    this.logResolution('prompts', resolved, source);
    return resolved;
  }

  /**
   * Get frameworks directory path: where frameworks are read from first, and where a write to them lands.
   * Resolution order: `resolveResourceSubdir`.
   */
  getFrameworksPath(): string {
    if (this.cache.frameworks) return this.cache.frameworks;
    const { resolved, source } = this.resolveResourceSubdir('frameworks');
    this.cache.frameworks = resolved;
    this.logResolution('frameworks', resolved, source);
    return resolved;
  }

  /**
   * Get gates directory path: where gates are read from first, and where a write to them lands.
   * Resolution order: `resolveResourceSubdir`.
   */
  getGatesPath(): string {
    if (this.cache.gates) return this.cache.gates;
    const { resolved, source } = this.resolveResourceSubdir('gates');
    this.cache.gates = resolved;
    this.logResolution('gates', resolved, source);
    return resolved;
  }

  /**
   * Get scripts directory path: where scripts are read from first, and where a write to them lands.
   * Resolution order: `resolveResourceSubdir`.
   */
  getScriptsPath(): string {
    if (this.cache.scripts) return this.cache.scripts;
    const { resolved, source } = this.resolveResourceSubdir('scripts');
    this.cache.scripts = resolved;
    this.logResolution('scripts', resolved, source);
    return resolved;
  }

  /**
   * Get styles directory path: where styles are read from first, and where a write to them lands.
   * Resolution order: `resolveResourceSubdir`.
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
      runtimeRoot: this.getRuntimeRoot(),
      runtimeState: this.getRuntimeStatePath(),
      resources: this.getResourcesPath(),
      config: this.getConfigPath(),
      prompts: this.getPromptsPath(),
      frameworks: this.getFrameworksPath(),
      gates: this.getGatesPath(),
      scripts: this.getScriptsPath(),
      styles: this.getStylesPath(),
      logs: this.getLogsPath(),
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
   * The answer describes the disk NOW, so a caller that re-resolves on every load (prompt reload,
   * category listing) sees an overlay created since startup. A caller that fixes its roots once —
   * a loader, the watch set — takes {@link getOverlayResourceCandidates} instead.
   *
   * @param resourceType - Resource subdirectory name (gates, frameworks, styles, scripts)
   * @param primaryDir - Primary resource dir to exclude from results (dedup)
   * @returns Existing workspace-relative directories not matching primary
   */
  getOverlayResourceDirs(resourceType: string, primaryDir?: string): string[] {
    return this.getOverlayResourceCandidates(resourceType, primaryDir).filter((dir) =>
      existsSync(dir)
    );
  }

  /**
   * Every directory that IS an overlay once it exists, whether or not it exists yet.
   *
   * For roots fixed at startup. Filtering these by existence once, at startup, is how a workspace
   * overlay created while the server ran contributed to neither the catalog nor the watch set
   * until a restart, for all four resource types. Loaders read an absent root as empty, and the
   * file observer watches it once it appears and reconciles it then.
   */
  getOverlayResourceCandidates(resourceType: string, primaryDir?: string): string[] {
    if (!this.isUsingCustomWorkspace()) return [];

    const workspace = this.getWorkspace();
    const candidates = [join(workspace, resourceType), join(workspace, 'resources', resourceType)];

    return candidates.filter((dir) => dir !== primaryDir);
  }

  /**
   * The package's own resources directory for a type — always a contributing root.
   *
   * `resolveResourceSubdir` names ONE directory per type, so a loader reading only that directory
   * never reads the bundled tree once a workspace has `resources/<type>/`. That is not a fallback;
   * it is a replacement, and before this root existed it failed three ways depending on the type:
   *
   *   - prompts: a workspace holding one prompt serves one prompt, and the 39 bundled ones vanish
   *     with nothing in the log to distinguish it from a healthy start
   *   - styles: an empty workspace `styles/` serves zero styles
   *   - frameworks: the server REFUSES TO START — `FrameworkRegistry.loadBuiltInGuides` throws
   *     `FATAL: Framework 'cageerf' not found`, because the definitions it requires ship in the
   *     package and the workspace does not have them
   *
   * Measured 2026-08-28 against a real STDIO server for all three. The documented contract
   * (`src/index.ts` help: "Custom workspace resources overlay bundled ones") describes an overlay;
   * what shipped was a replacement.
   *
   * Callers pass this as the lowest-precedence contributing root so the bundled definitions are
   * always present and a workspace entry with the same id still wins.
   */
  getBundledResourceDir(resourceType: string): string {
    return join(this.config.packageRoot, 'resources', resourceType);
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
    return resolveSettingPath(inputPath);
  }

  /**
   * Resolve a resource subdirectory: the directory a type is read from first and written to.
   *
   * A custom workspace with no `MCP_RESOURCES_PATH` resolves inside the workspace:
   *   1. ${workspace}/resources/${subdir}/ (if exists)
   *   2. ${workspace}/${subdir}/ (legacy, if exists, so an existing collection does not split)
   *   3. ${workspace}/resources/${subdir}/ (not created yet; the first write creates it)
   *
   * Otherwise (an explicit `MCP_RESOURCES_PATH`, or the package root as the workspace):
   *   1. ${resources}/${subdir}/ (if exists)
   *   2. ${workspace}/${subdir}/ (legacy, if exists)
   *   3. ${packageRoot}/resources/${subdir}/ (default)
   *
   * Step 3 of the workspace chain names a directory that may not exist. Falling through to the
   * package instead sent every write from an empty workspace into the install directory, which a
   * plugin update replaces. Readers treat the absent directory as empty, and the bundled tree
   * still loads underneath (`getBundledResourceDir`).
   */
  private resolveResourceSubdir(subdir: string): { resolved: string; source: string } {
    const workspace = this.getWorkspace();
    const legacyDir = join(workspace, subdir);
    const explicitResources = process.env['MCP_RESOURCES_PATH'];

    if (
      (explicitResources === undefined || explicitResources === '') &&
      this.isUsingCustomWorkspace()
    ) {
      const workspaceDir = join(workspace, 'resources', subdir);
      if (existsSync(workspaceDir)) {
        return { resolved: workspaceDir, source: `workspace resources/${subdir}/` };
      }
      if (existsSync(legacyDir)) {
        return { resolved: legacyDir, source: `workspace ${subdir}/ (legacy)` };
      }
      return {
        resolved: workspaceDir,
        source: `workspace resources/${subdir}/ (created on first write)`,
      };
    }

    const resourcesDir = join(this.getResourcesPath(), subdir);
    if (existsSync(resourcesDir)) {
      return { resolved: resourcesDir, source: `resources/${subdir}/` };
    }

    if (existsSync(legacyDir)) {
      return { resolved: legacyDir, source: `workspace ${subdir}/ (legacy)` };
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
