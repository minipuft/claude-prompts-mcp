// @lifecycle canonical - Interface for ConfigManager, consumed by all layers except runtime/.
/**
 * ConfigManager decouples modules/, mcp/, and engine/ from the concrete
 * ConfigManager in infra/config.  Only the runtime/ composition root
 * creates and manages the concrete class.
 */

import type {
  Config,
  AnalysisConfig,
  SemanticAnalysisConfig,
  LoggingConfig,
  ResolvedFrameworkConfig,
  GateSystemSettings,
  ChainSessionConfig,
  ExecutionConfig,
  VersioningConfig,
  ResourcesConfig,
  TelemetryConfig,
  TransportMode,
} from './core-config.js';
import type { InjectionConfig } from './injection.js';

export interface ConfigSchemaValidationResult {
  /** 'valid' = AJV accepted the config. 'invalid' = AJV rejected it. 'unavailable' = the schema
   *  itself could not be read, parsed, or compiled — this is NOT a claim about the config. */
  status: 'valid' | 'invalid' | 'unavailable';
  /** True only when status is 'valid'. Kept alongside `status` so existing reads keep compiling. */
  valid: boolean;
  errors: string[];
}

/** Which layer produced a config value: the user's `config.json`, the built-in defaults this
 *  loader fills in for anything the file omits, a process environment variable that overrides
 *  both (`PORT`, `LOG_LEVEL` today), or `'deferred'`.
 *
 *  `'deferred'` is not a fourth kind of value — it is the honest label for NO value: the packaged
 *  `config.schema.json` declares the key, but neither the raw file nor this loader's own
 *  load-time defaulting (`validateAndSetDefaults`) produced one, because the section it lives in
 *  is one of the ones that loader never writes back (e.g. `gates`, `resources`, `logging`,
 *  `identity`, `verification`) — only the OWNING getter defaults that section, and only when it is
 *  actually called (e.g. `gates.enabled` inside `getGatesConfig()`). Do not confuse this with
 *  `'default'`: `'default'` means the loaded config HOLDS a concrete value nobody set in the file
 *  (that loader-level defaulting ran); `'deferred'` means it holds none, so `value` is always
 *  `undefined` for this source — never invented here. */
export type ConfigValueSource = 'file' | 'default' | 'environment' | 'deferred';

/**
 * The effective value of a dot-path config key (e.g. `server.port`) plus which layer produced it.
 *
 * `source: 'environment'` means `value` is what the running server actually uses, even where it
 * differs from what `getConfig()` would show for the same path — an env override shadows both the
 * file and the default rather than merging with them.
 */
export interface ConfigValueWithSource {
  key: string;
  value: unknown;
  source: ConfigValueSource;
}

/**
 * Read-only configuration access + event subscription for hot-reload.
 *
 * Lifecycle methods (startWatching, stopWatching, shutdown) are intentionally
 * excluded — only the runtime/ composition root manages ConfigManager lifecycle.
 */
export interface ConfigManager {
  // ── Core config access ───────────────────────────────────────────────

  getConfig(): Config;
  getServerConfig(): Config['server'];
  getPromptsConfig(): Config['prompts'];
  getPromptsRegisterWithMcp(): boolean | undefined;
  getTransportMode(): TransportMode;

  // ── Schema validation ────────────────────────────────────────────────

  /** Schema check from the last successful config load. Undefined means NOT validated — no
   *  schema path was injected, or the last load fell back to defaults; never read as valid. */
  getSchemaValidation(): ConfigSchemaValidationResult | undefined;

  // ── Dot-path config access ───────────────────────────────────────────

  /**
   * The effective value of a dot-path key (`server.port`, `logging.level`, `gates.enabled`, …)
   * and which layer produced it. Reports `'environment'` whenever an env override is active for
   * that key — currently `server.port` (`PORT`) and `logging.level` (`LOG_LEVEL`) — with `value`
   * set to what the server actually uses, not the file/default value the override shadows. A key
   * absent from both the raw file AND this loader's own load-time defaulting resolves to
   * `{ value: undefined, source: 'deferred' }` — never `'default'`, which is reserved for a
   * defaulted value that actually resolved. See {@link ConfigValueSource} for the distinction.
   */
  getConfigValueWithSource(key: string): ConfigValueWithSource;

  /**
   * The dot-path keys the packaged `config.schema.json` declares — derived from the schema, never
   * hardcoded. Rejects if the schema was not injected, or could not be read or parsed: an
   * unreadable schema must never read as "this config has zero keys".
   */
  listConfigKeys(): Promise<string[]>;

  // ── Domain config getters ────────────────────────────────────────────

  // No `getAnalysisConfig` / `getSemanticAnalysisConfig`: the deprecated
  // `analysis.semanticAnalysis` section is still parsed and defaulted at load (and warns once),
  // but nothing reads the parsed value any more — the analyzer that took it never read a field.
  getLoggingConfig(): LoggingConfig;
  getFrameworksConfig(): ResolvedFrameworkConfig;
  getGatesConfig(): GateSystemSettings;
  getChainSessionConfig(): ChainSessionConfig;
  getExecutionConfig(): ExecutionConfig;
  isJudgeEnabled(): boolean;
  getVersioningConfig(): VersioningConfig;
  getResourcesConfig(): ResourcesConfig;
  getTelemetryConfig(): TelemetryConfig;
  getInjectionConfig(): InjectionConfig;

  // ── Path resolution ──────────────────────────────────────────────────

  getPort(): number;
  getConfigPath(): string;
  getPromptsDirectory(): string;
  getResolvedPromptsDirectory(overridePath?: string): string;
  getServerRoot(): string;
  getGatesDirectory(): string;
  getFrameworksDirectory(): string;
  getScriptsDirectory(): string;
  getStylesDirectory(): string;
  /**
   * The bundled (package-shipped) directory for a resource type — always read, never written.
   * Undefined when no path source is injected, meaning "no distinct bundled source".
   */
  getBundledResourceDirectory(resourceType: string): string | undefined;
  getOverlayResourceDirectories(resourceType: string, primaryDir?: string): string[];
  /** The writable runtime state directory (`state.db`, `verify-state.db`). Never the package. */
  getRuntimeStateDirectory(): string;

  // ── Config reload ────────────────────────────────────────────────────

  loadConfig(): Promise<Config>;

  // ── Event subscription (hot-reload) ──────────────────────────────────

  on(event: 'configChanged', listener: (config: Config) => void): this;
  on(
    event: 'frameworksConfigChanged',
    listener: (current: ResolvedFrameworkConfig, previous: ResolvedFrameworkConfig) => void
  ): this;
  off(event: 'configChanged', listener: (config: Config) => void): this;
  off(
    event: 'frameworksConfigChanged',
    listener: (current: ResolvedFrameworkConfig, previous: ResolvedFrameworkConfig) => void
  ): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): this;
}
