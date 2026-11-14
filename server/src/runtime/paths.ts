// @lifecycle canonical - Centralized path resolution for all configuration assets.
/**
 * PathResolver - Unified Path Resolution System
 *
 * CLI flags take precedence over their workspace/config environment settings.
 * Each resource type reads from one ordered location list, `getResourceLocations`: the project's
 * `.claude-prompts/` (STDIO discovery), the profile's own folder or the `MCP_RESOURCES_PATH`
 * folder in its place, the config's `paths.resources` entries, then the bundle — where the list
 * names `"bundled"`, last when there is no list, and nowhere when a list leaves it out. An earlier
 * location wins a duplicate id. An absent type directory is created by its first write.
 *
 * Environment Variables:
 * - MCP_WORKSPACE: Full plugin/workspace directory (server/, hooks/, etc.)
 * - CLAUDE_PLUGIN_DATA: Claude Code's plugin data directory; the workspace when MCP_WORKSPACE is unset
 * - MCP_RUNTIME_ROOT: Writable directory for state and logs
 * - MCP_RESOURCES_PATH: One folder that replaces the profile's own resources folder; the config's
 *   paths.resources entries still follow it. This file is its only reader.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { basename, join, resolve, isAbsolute } from 'path';

import type { ServerCliArgs } from './cli.js';

import {
  configFileFormat,
  findWorkspaceConfigFiles,
  parseConfigText,
} from '#shared/utils/config-file-format.js';
import { selectConfigFile, type ConfigFileOrigin } from '#shared/utils/config-file-selection.js';
import {
  assertUsableDirectorySetting,
  describeRemoval,
  formatPathSettingRefusal,
  PathSettingError,
  resolveSettingPath,
  type PathFallback,
  type PathSetting,
} from '#shared/utils/path-setting.js';
import { deriveProjectDir } from '#shared/utils/project-scope.js';
import {
  RUNTIME_STATE_DIR_NAME,
  STATE_DB_FILE_NAME,
} from '#shared/utils/runtime-state-location.js';

/** The directory a project keeps its own resources in, directly under the project directory. */
const PROJECT_WORKSPACE_DIR_NAME = '.claude-prompts';

/** The reserved `paths.resources` entry naming the package's own resources (`infra/config`). */
const BUNDLED_RESOURCES_ENTRY = 'bundled';

/** The config's `paths` section as the resolver reads it (`Config.paths`, resolved by the loader). */
interface ConfiguredResourcePaths {
  readonly resources: readonly string[];
  readonly writeTarget?: string;
}

/** One folder that contributes definitions of a resource type, and why it is in the list. */
interface ResourceLocationEntry {
  path: string;
  /**
   * `project`: `<project>/.claude-prompts/resources/<type>`. `profile`: the profile's own folder
   * (or the `MCP_RESOURCES_PATH` folder in its place) and the workspace's other layout beside it.
   * `listed`: a `paths.resources` entry. `bundled`: the package's own folder.
   */
  kind: 'project' | 'profile' | 'listed' | 'bundled';
  /** The setting or convention that put it in the list, for a reader of the list. */
  source: string;
}

/** The effective locations of one resource type (the plan's Design decisions table, R3c/R3j/R3k/R3l/R3p). */
export interface ResourceLocations {
  /** Highest precedence first, each path once: an earlier location wins a duplicate id (R3l). */
  locations: ResourceLocationEntry[];
  /**
   * Where a write of this type lands: the project folder when `.claude-prompts/` exists, else
   * `<paths.writeTarget>/<type>` when the config names one, else the profile's own folder (R3j).
   */
  writeRoot: string;
  /**
   * A `paths.resources` list is in force and does not name `"bundled"`, so the bundle is NOT in
   * {@link locations} (R3c): only the listed folders, the project folder and the profile's own
   * folder serve. The run-required frameworks still load from the package
   * (`RuntimeFrameworkLoaderConfig.shippedFrameworksDir`), and nothing else does.
   */
  bundledImplicit: boolean;
}

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
  /**
   * Whether the launch's project directory may contribute a resource root (R1-R3). Off unless the
   * caller turns it on: a process serving several projects has no single project directory to look
   * in.
   */
  projectDiscovery?: boolean;
  /**
   * Where the project directory is read from when {@link projectDiscovery} is on. Defaults to the
   * process environment and working directory; injectable so a test names its project directory
   * without changing either.
   */
  projectLaunch?: { env?: NodeJS.ProcessEnv; cwd?: string };
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
type WorkspaceSource = PathSetting & {
  name: '--workspace' | 'MCP_WORKSPACE' | 'CLAUDE_PLUGIN_DATA';
};

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
    parsed = parseConfigText(content, configFileFormat(resolved));
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
  /**
   * The profile's own per-type directories (entry two of the location list), kept apart from
   * {@link cache} because they are keyed by type.
   */
  private typePaths: Partial<Record<string, { resolved: string; source: string }>> = {};
  /**
   * The config's `paths` section, resolved: its `resources` list and its `writeTarget`. Empty
   * until the composition root hands it over.
   */
  private configuredPaths: () => ConfiguredResourcePaths = () => ({ resources: [] });
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
   *   2. MCP_WORKSPACE environment variable
   *   3. CLAUDE_PLUGIN_DATA environment variable (Claude Code passes it to a plugin's server;
   *      the Python hooks read the same two variables in the same order)
   *   4. Package root (default - npx fallback)
   */
  getWorkspace(): string {
    if (this.cache.workspace) return this.cache.workspace;

    let resolved: string;
    let source: string;
    const pluginData = process.env['CLAUDE_PLUGIN_DATA'];

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
    // 3. The Claude Code plugin data directory, which survives plugin updates
    else if (pluginData !== undefined && pluginData !== '') {
      resolved = this.resolvePath(pluginData);
      source = 'CLAUDE_PLUGIN_DATA (plugin data directory)';
    }
    // 4. Package root (default - npx fallback)
    else {
      resolved = this.config.packageRoot;
      source = 'package root (default)';
    }

    this.cache.workspace = resolved;
    this.logResolution('workspace', resolved, source);
    return resolved;
  }

  /**
   * The project's own resource workspace, `<project>/.claude-prompts/`, or `undefined` when none
   * applies: discovery is off, or the directory does not exist.
   *
   * "Exists" is the directory itself, not a per-type folder under it. Those are created by the
   * first write, as a workspace's are. Probed on every call, like the type getters' own
   * `existsSync` probes, so a directory created while the server runs is seen by the next
   * resolution.
   */
  getProjectWorkspace(): string | undefined {
    if (this.config.projectDiscovery !== true) return undefined;

    const projectWorkspace = this.projectWorkspacePath();
    if (projectWorkspace === undefined) return undefined;

    try {
      return statSync(projectWorkspace).isDirectory() ? projectWorkspace : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Where the project's `.claude-prompts/` is or would be, existing or not; `undefined` when
   * discovery is off or the launch names no project directory.
   */
  private projectWorkspacePath(): string | undefined {
    if (this.config.projectDiscovery !== true) return undefined;

    const launch = this.config.projectLaunch;
    const projectDir = deriveProjectDir(launch?.env, launch?.cwd);
    if (projectDir === undefined) return undefined;

    return join(this.resolvePath(projectDir.value), PROJECT_WORKSPACE_DIR_NAME);
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
    this.cache.runtimeState ??= join(this.getRuntimeRoot(), RUNTIME_STATE_DIR_NAME);
    return this.cache.runtimeState;
  }

  /** The server's SQLite database — the one path every `SqliteEngine.getInstance` call names. */
  getStateDatabasePath(): string {
    return join(this.getRuntimeStatePath(), STATE_DB_FILE_NAME);
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
   * This is the resource base; each type getter also preserves existing legacy workspace dirs.
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
   * An empty value counts as unset, as it does in the getters, and a workspace with no config file
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
    if (this.readExplicitConfigSource() === undefined) {
      // The project directory outranks the workspace, so its config is judged first.
      this.assertUsableProjectConfig();
      if (workspace !== undefined) {
        this.assertSingleWorkspaceConfig(workspace);
        this.assertUsableWorkspaceConfig(workspace);
      }
    }
  }

  /** The workspace path: flag, then `MCP_WORKSPACE`, then `CLAUDE_PLUGIN_DATA`; an empty value counts as unset. */
  private readWorkspaceSource(): WorkspaceSource | undefined {
    const fromFlag = this.config.cli.workspace;
    if (fromFlag !== undefined && fromFlag !== '') return { name: '--workspace', value: fromFlag };
    const fromEnv = process.env['MCP_WORKSPACE'];
    if (fromEnv !== undefined && fromEnv !== '') return { name: 'MCP_WORKSPACE', value: fromEnv };
    const fromPlugin = process.env['CLAUDE_PLUGIN_DATA'];
    if (fromPlugin !== undefined && fromPlugin !== '') {
      return { name: 'CLAUDE_PLUGIN_DATA', value: fromPlugin };
    }
    return undefined;
  }

  /** What removing a workspace setting falls back to: the next variable in the order, else the package root. */
  private describeWorkspaceFallback(workspace: WorkspaceSource): PathFallback {
    const fromEnv = process.env['MCP_WORKSPACE'];
    if (workspace.name === '--workspace' && fromEnv !== undefined && fromEnv !== '') {
      return { label: 'the MCP_WORKSPACE workspace', resolved: resolveSettingPath(fromEnv) };
    }
    const fromPlugin = process.env['CLAUDE_PLUGIN_DATA'];
    if (workspace.name !== 'CLAUDE_PLUGIN_DATA' && fromPlugin !== undefined && fromPlugin !== '') {
      return {
        label: 'the CLAUDE_PLUGIN_DATA workspace',
        resolved: resolveSettingPath(fromPlugin),
      };
    }
    return { label: 'the package root', resolved: this.config.packageRoot };
  }

  /**
   * A workspace naming both `config.jsonc` and `config.json` is ambiguous about which one is in
   * effect — refuse rather than pick the `.jsonc` precedence silently. Named after
   * {@link assertUsableDirectorySetting} so the workspace itself is refused first when it is not
   * usable at all, before either of its config files is inspected.
   */
  private assertSingleWorkspaceConfig(workspace: WorkspaceSource): void {
    const found = findWorkspaceConfigFiles(this.getWorkspace());
    if (found.length < 2) return;
    const [jsoncPath, jsonPath] = found as [string, string];
    throw new PathSettingError(
      formatPathSettingRefusal({
        setting: workspace,
        resolved: this.getWorkspace(),
        problem: `holds both config.jsonc (${jsoncPath}) and config.json (${jsonPath})`,
        expected: 'a single config file',
        remedy: `keep config.jsonc, the current name, and remove config.json (also still read)`,
      })
    );
  }

  /**
   * The project's `.claude-prompts/` naming both `config.jsonc` and `config.json` is ambiguous
   * for the same reason a workspace is, and is refused the same way. No operator setting names the
   * project directory (it is discovered), so the message names the directory and both files rather
   * than a flag. A project config it holds must also be readable: resolving to a file and then
   * booting on built-in defaults because it was not is the failure `getConfigPath` exists to prevent.
   */
  private assertUsableProjectConfig(): void {
    const projectWorkspace = this.getProjectWorkspace();
    if (projectWorkspace === undefined) return;
    const found = findWorkspaceConfigFiles(projectWorkspace);
    if (found.length >= 2) {
      const [jsoncPath, jsonPath] = found as [string, string];
      throw new PathSettingError(
        [
          `Refusing to start: the project workspace ${projectWorkspace} holds both config.jsonc (${jsoncPath}) and config.json (${jsonPath}).`,
          `Expected a single config file there, or keep config.jsonc, the current name, and remove config.json (also still read).`,
        ].join('\n')
      );
    }
    const [config] = found;
    if (config === undefined) return;
    const problem = describeUnusableConfigFile(config);
    if (problem === undefined) return;
    throw new PathSettingError(
      [
        `Refusing to start: the project workspace ${projectWorkspace} holds a config file ${config} that ${problem}.`,
        `Expected a readable JSON config file there, or move it out of the project workspace to use the next config in the order.`,
      ].join('\n')
    );
  }

  /** A config file the workspace holds must be usable; one it does not hold falls back to the packaged config. */
  private assertUsableWorkspaceConfig(workspace: WorkspaceSource): void {
    const { resolved, origin } = this.resolveDefaultConfigPath();
    if (origin !== 'workspace') return;
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
   * Get the config file path
   *
   * Priority:
   *   1. --config CLI flag
   *   2. MCP_CONFIG_PATH environment variable
   *   3. ${project}/.claude-prompts/config.jsonc, else config.json (project discovery on and
   *      the directory holds either)
   *   4. ${workspace}/config.jsonc, else ${workspace}/config.json (if workspace differs from
   *      package and either file exists)
   *   5. ${packageRoot}/config.json (default — the packaged file keeps its `.json` name)
   *
   * An explicit path (1 or 2) that is not a readable config file throws `PathSettingError`, parsed
   * by extension (`.jsonc` tolerant of comments and a trailing comma, everything else strict
   * JSON) via {@link parseConfigText}. `ConfigLoader.loadConfig` answers an unreadable file with
   * the built-in defaults, which is a sensible floor for the package's own file and the wrong
   * answer for a path an operator named: the server booted, served the bundled catalog, and never
   * used the settings asked for.
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
    const { resolved, origin } = this.resolveDefaultConfigPath();
    if (origin === 'package') return { label: 'the packaged default', resolved };
    const caveat = describeUnusableConfigFile(resolved);
    const label = origin === 'project' ? 'the project config' : 'the workspace config';
    return { label, resolved, ...(caveat !== undefined && { caveat }) };
  }

  /**
   * Where config resolves when nothing names a path: the project's `.claude-prompts/` file if
   * present, else the workspace's, else the package's — steps 2-5 from `selectConfigFile`, the one
   * place every config reader takes that order from, and the shipped file as step 6. `origin` is
   * what every caller branches on — `'project'`, `'workspace'` or `'package'` (`'explicit'` is
   * never passed in, so never comes back) — kept
   * separate from `source`, the human-readable label passed to {@link logResolution}, so that
   * label can name whichever filename was actually found without becoming the thing callers
   * compare against.
   */
  private resolveDefaultConfigPath(): {
    resolved: string;
    origin: ConfigFileOrigin | 'package';
    source: string;
  } {
    const workspace = this.getWorkspace();
    const selected = selectConfigFile({
      projectWorkspace: this.getProjectWorkspace(),
      // A workspace that IS the package root is the package step below, not a second source.
      workspace: workspace === this.config.packageRoot ? undefined : workspace,
    });
    if (selected !== undefined) {
      return {
        resolved: selected.path,
        origin: selected.origin,
        source: `${selected.origin} ${basename(selected.path)}`,
      };
    }
    return {
      resolved: join(this.config.packageRoot, 'config.json'),
      origin: 'package',
      source: 'package config.json (default)',
    };
  }

  /**
   * Get prompts directory path: where prompts are read from first, and where a write to them lands.
   * Resolution order: `resourceSubdirPath`.
   */
  getPromptsPath(): string {
    return this.resourceSubdirPath('prompts');
  }

  /**
   * Get frameworks directory path: where frameworks are read from first, and where a write to them lands.
   * Resolution order: `resourceSubdirPath`.
   */
  getFrameworksPath(): string {
    return this.resourceSubdirPath('frameworks');
  }

  /**
   * Get gates directory path: where gates are read from first, and where a write to them lands.
   * Resolution order: `resourceSubdirPath`.
   */
  getGatesPath(): string {
    return this.resourceSubdirPath('gates');
  }

  /**
   * Get scripts directory path: where scripts are read from first, and where a write to them lands.
   * Resolution order: `resourceSubdirPath`.
   */
  getScriptsPath(): string {
    return this.resourceSubdirPath('scripts');
  }

  /**
   * Get styles directory path: where styles are read from first, and where a write to them lands.
   * Resolution order: `resourceSubdirPath`.
   */
  getStylesPath(): string {
    return this.resourceSubdirPath('styles');
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
   * Hand the resolver the config's `paths` section: the `resources` list, absolute and in the
   * file's order, and the `writeTarget`, absolute, which the loader has already proven names a
   * listed entry or {@link getProfileResourcesDir}.
   *
   * Called once by the composition root, after the config loads: the resolver picks the config
   * file, so it cannot be constructed with what that file says. Read through `read` on every
   * resolution, so a reloaded config is the section the next resolution sees. Until then the list
   * is empty and no write target is set, which is also what a config without the keys means.
   */
  readResourceLocationsFrom(read: () => ConfiguredResourcePaths): void {
    this.configuredPaths = read;
  }

  /**
   * The profile's own resources folder, the one whose `<type>` folders are entry two of
   * {@link getResourceLocations}: the `MCP_RESOURCES_PATH` folder when set, else the custom
   * workspace's `resources/`. Undefined when neither applies, because the profile's folder is
   * then the package's own, which is never written. `paths.writeTarget` may name it besides the
   * listed entries.
   */
  getProfileResourcesDir(): string | undefined {
    if (this.hasExplicitResourcesPath()) return this.getResourcesPath();
    if (this.isUsingCustomWorkspace()) return join(this.getWorkspace(), 'resources');
    return undefined;
  }

  /**
   * The `paths.resources` list in force, absolute and in the file's order, `"bundled"` kept as
   * that literal; empty when the config names none. For a reader that reports the list itself
   * (the startup count line, R3n) — which folders serve a type is {@link getResourceLocations}.
   */
  getConfiguredResourceLocations(): readonly string[] {
    return this.configuredPaths().resources;
  }

  /**
   * THE location list for one resource type, highest precedence first — every other reader of
   * "which folders contribute, in what order" takes it from here (`resolveResourceRoots`, the
   * overlay getters below, the per-type write roots).
   *
   * 1. the project folder `<project>/.claude-prompts/resources/<type>` whenever discovery names a
   *    project, with or without `MCP_RESOURCES_PATH`. Listed before `.claude-prompts/` exists too:
   *    loaders read it as empty and the file observer watches it, so a folder created while the
   *    server runs is served without a restart. It is the write root only once it exists.
   * 2. the profile's own folder, or the `MCP_RESOURCES_PATH` folder in its place
   *    ({@link resolveResourceSubdir}), then the custom workspace's other layout beside it, so a
   *    workspace whose collection sits in both `resources/<type>` and `<type>` keeps both.
   * 3. each `paths.resources` entry as `<entry>/<type>`, in the file's order.
   * 4. the bundle at the position `"bundled"` is listed; appended last when no list is in force;
   *    absent when a list is in force and leaves `"bundled"` out (`bundledImplicit`).
   *
   * A path appears once, at its first position. Reports only: nothing is created.
   */
  getResourceLocations(resourceType: string): ResourceLocations {
    const candidates: ResourceLocationEntry[] = [];

    const projectWorkspace = this.projectWorkspacePath();
    if (projectWorkspace !== undefined) {
      candidates.push({
        path: join(projectWorkspace, 'resources', resourceType),
        kind: 'project',
        source:
          this.getProjectWorkspace() !== undefined
            ? 'project .claude-prompts/'
            : 'project .claude-prompts/ (not created yet; read once it exists)',
      });
    }

    const bundledDir = this.getBundledResourceDir(resourceType);
    const profile = this.profileResourceDir(resourceType);
    // With neither a custom workspace nor `MCP_RESOURCES_PATH`, the profile's folder IS the
    // package's: it is the bundle, and is placed by the bundle's rule (entry 4) rather than ranked
    // as entry two — otherwise a list that leaves `"bundled"` out, or names it later, would still
    // serve the bundle second.
    if (profile.resolved !== bundledDir) {
      candidates.push({ path: profile.resolved, kind: 'profile', source: profile.source });
    }
    if (this.isUsingCustomWorkspace()) {
      const workspace = this.getWorkspace();
      candidates.push(
        {
          path: join(workspace, 'resources', resourceType),
          kind: 'profile',
          source: `workspace resources/${resourceType}/`,
        },
        {
          path: join(workspace, resourceType),
          kind: 'profile',
          source: `workspace ${resourceType}/ (legacy)`,
        }
      );
    }

    const configured = this.configuredPaths().resources;
    configured.forEach((entry, index) => {
      candidates.push(
        entry === BUNDLED_RESOURCES_ENTRY
          ? { path: bundledDir, kind: 'bundled', source: `paths.resources[${index}] "bundled"` }
          : { path: join(entry, resourceType), kind: 'listed', source: `paths.resources[${index}]` }
      );
    });
    const bundledImplicit = configured.length > 0 && !configured.includes(BUNDLED_RESOURCES_ENTRY);
    if (configured.length === 0) {
      candidates.push({ path: bundledDir, kind: 'bundled', source: 'package resources (last)' });
    }

    const seen = new Set<string>();
    const locations = candidates.filter((location) => {
      if (seen.has(location.path)) return false;
      seen.add(location.path);
      return true;
    });

    return { locations, writeRoot: this.resourceSubdirPath(resourceType), bundledImplicit };
  }

  /**
   * The locations beside `primaryDir` that exist right now, lowest precedence first.
   *
   * The answer describes the disk NOW, so a caller that re-resolves on every load (prompt reload,
   * category listing) sees an overlay created since startup. A caller that fixes its roots once —
   * a loader, the watch set — takes {@link getOverlayResourceCandidates} instead.
   *
   * @param resourceType - Resource subdirectory name (gates, frameworks, styles, scripts)
   * @param primaryDir - Primary resource dir to exclude from results (dedup)
   */
  getOverlayResourceDirs(resourceType: string, primaryDir?: string): string[] {
    return this.getOverlayResourceCandidates(resourceType, primaryDir).filter((dir) =>
      existsSync(dir)
    );
  }

  /**
   * Every location of {@link getResourceLocations} except `primaryDir`, whether or not it exists
   * yet, LOWEST precedence first: the reverse of the list, because the prompt loader and the
   * category listing merge in that direction and a later root wins there.
   *
   * The bundle is IN this list wherever {@link getResourceLocations} holds it — first here when
   * there is no `paths.resources` list, at its reversed position where the list names
   * `"bundled"`, and not at all when a list leaves it out. A merging reader recognises it by
   * comparing against {@link getBundledResourceDir}; it is never a second, separately placed root.
   *
   * For roots fixed at startup. Filtering these by existence once, at startup, is how a workspace
   * overlay created while the server ran contributed to neither the catalog nor the watch set
   * until a restart, for all four resource types. Loaders read an absent root as empty, and the
   * file observer watches it once it appears and reconciles it then.
   */
  getOverlayResourceCandidates(resourceType: string, primaryDir?: string): string[] {
    return this.getResourceLocations(resourceType)
      .locations.map((location) => location.path)
      .filter((dir) => dir !== primaryDir)
      .reverse();
  }

  /**
   * The package's own resources directory for a type: its identity, not a claim that it serves.
   * Whether and where it contributes is {@link getResourceLocations}'s answer.
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
   * With no `paths.resources` list the bundle is the lowest-precedence location, so the bundled
   * definitions are always present and a workspace entry with the same id still wins. A list that
   * leaves `"bundled"` out removes it (R3c); the six shipped frameworks still load from here.
   */
  getBundledResourceDir(resourceType: string): string {
    return join(this.config.packageRoot, 'resources', resourceType);
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

  private hasExplicitResourcesPath(): boolean {
    const explicitResources = process.env['MCP_RESOURCES_PATH'];
    return explicitResources !== undefined && explicitResources !== '';
  }

  /** Entry two of the location list for `subdir`, resolved once per type. */
  private profileResourceDir(subdir: string): { resolved: string; source: string } {
    const cached = this.typePaths[subdir];
    if (cached !== undefined) return cached;
    const resolution = this.resolveResourceSubdir(subdir);
    this.typePaths[subdir] = resolution;
    this.logResolution(subdir, resolution.resolved, resolution.source);
    return resolution;
  }

  /**
   * The directory a type is written to: the project folder when `.claude-prompts/` exists
   * (R3j keeps its precedence, whether or not `MCP_RESOURCES_PATH` or `paths.writeTarget` is set),
   * else `<paths.writeTarget>/<type>` when the config names a folder other than the profile's,
   * else the profile's own folder — unless that folder is the package's own and a
   * `paths.resources` list is in force: the package folder is then the bundle, never written, and
   * the first listed folder takes the writes (R3r). A list naming only `"bundled"` lists no folder,
   * so the package folder stays the write root there, as it is with no list at all.
   *
   * The project directory is probed on every call, so a `.claude-prompts/` created (or removed)
   * while the server runs changes every type's answer on the next call. The profile's folder is
   * resolved once per type ({@link profileResourceDir}).
   */
  private resourceSubdirPath(subdir: string): string {
    const projectWorkspace = this.getProjectWorkspace();
    if (projectWorkspace !== undefined) return join(projectWorkspace, 'resources', subdir);
    const { writeTarget } = this.configuredPaths();
    // Naming the profile's own folder is the unset answer: its legacy `<workspace>/<type>` layout
    // is kept rather than flattened to `<folder>/<type>`.
    if (writeTarget !== undefined && writeTarget !== this.getProfileResourcesDir()) {
      return join(writeTarget, subdir);
    }
    if (this.getProfileResourcesDir() === undefined) {
      const firstListed = this.configuredPaths().resources.find(
        (entry) => entry !== BUNDLED_RESOURCES_ENTRY
      );
      if (firstListed !== undefined) return join(firstListed, subdir);
    }
    return this.profileResourceDir(subdir).resolved;
  }

  /**
   * Resolve the profile's own folder for a type: entry two of {@link getResourceLocations}, and
   * the write root whenever no project `.claude-prompts/` exists.
   *
   * A custom workspace with no `MCP_RESOURCES_PATH` resolves inside the workspace:
   *   1. ${workspace}/resources/${subdir}/ (if exists)
   *   2. ${workspace}/${subdir}/ (legacy, if exists, so an existing collection does not split)
   *   3. ${workspace}/resources/${subdir}/ (not created yet; the first write creates it)
   *
   * An explicit `MCP_RESOURCES_PATH` takes the profile folder's place (R3p), each type through:
   *   1. ${resources}/${subdir}/ (if exists)
   *   2. ${workspace}/${subdir}/ (legacy, if exists)
   *   3. ${resources}/${subdir}/ (not created yet; the first write creates it)
   *
   * With neither an explicit base nor a custom workspace, existing resource and legacy dirs
   * retain their priority, then the package resource directory is the default.
   *
   * A write root may not exist yet. Existence-based fallback would send first writes into the
   * install directory, which a plugin update replaces, or outside an explicit resource boundary.
   * Readers treat the absent directory as empty; bundled resources still load underneath
   * (`getBundledResourceDir`).
   */
  private resolveResourceSubdir(subdir: string): { resolved: string; source: string } {
    const workspace = this.getWorkspace();
    const legacyDir = join(workspace, subdir);
    const hasExplicitResources = this.hasExplicitResourcesPath();

    if (!hasExplicitResources && this.isUsingCustomWorkspace()) {
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

    if (hasExplicitResources) {
      return {
        resolved: resourcesDir,
        source: `resources/${subdir}/ (created on first write)`,
      };
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
// Transport and Project Discovery
// ============================================================================

/**
 * Whether a server on `transport` may look for the launch's project `.claude-prompts/` (R4).
 *
 * Only a STDIO process serves one project: the client launches it from that project. An HTTP
 * process (`streamable-http`, or `both`, which opens the HTTP listener too) serves many projects
 * from one working directory, so the directory it started in names none of them. An absent value
 * is STDIO, the default `resolveRuntimeLaunchOptions` applies. Callers pass the mode
 * `TransportRouter.determineTransport` returns, which has already mapped an invalid value to STDIO.
 */
export function discoversProjectOver(transport: string | undefined): boolean {
  return transport === undefined || transport === 'stdio';
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
    projectDiscovery: discoversProjectOver(cliArgs.transport),
  });
}
