// @lifecycle canonical - Interface for ConfigManager, consumed by all layers except runtime/.
/**
 * ConfigManager decouples modules/, mcp/, and engine/ from the concrete
 * ConfigManager in infra/config.  Only the runtime/ composition root
 * creates and manages the concrete class.
 */

import type {
  Config,
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

/** Which layer produced a config value: the user's `config.json`, the built-in defaults the
 *  config loader fills in for anything the file omits, or a process environment variable that
 *  overrides both (`PORT`, `LOG_LEVEL` today).
 *
 *  There is no fourth label. `'deferred'` existed while some sections resolved only inside their
 *  owning getter, so a declared key could hold no value at all at the `Config` layer; since row
 *  6.2 / Ruling R57 `normalizeConfigFile` resolves EVERY section at load time, and `'default'`
 *  carries the value the server actually uses.
 *
 *  A `'default'` answer whose `value` is `undefined` means the key has no default in any layer —
 *  a property of the key, not of the load. That set is small, deliberate, and pinned as a literal
 *  by `tests/unit/infra/config/config-value-source.test.ts`, so a new one is a red test. */
export type ConfigValueSource = 'file' | 'default' | 'environment';

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
  getPromptsRegisterWithMcp(): boolean;
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
   * the file does not set resolves to `{ value: <the loader's resolved default>, source:
   * 'default' }`; `value` is `undefined` only for the handful of keys that have no default in any
   * layer. See {@link ConfigValueSource}.
   */
  getConfigValueWithSource(key: string): ConfigValueWithSource;

  /**
   * The dot-path keys the packaged `config.schema.json` declares — derived from the schema, never
   * hardcoded. Rejects if the schema was not injected, or could not be read or parsed: an
   * unreadable schema must never read as "this config has zero keys".
   */
  listConfigKeys(): Promise<string[]>;

  // ── Domain config getters ────────────────────────────────────────────

  // No `getAnalysisConfig` / `getSemanticAnalysisConfig`: the `analysis.semanticAnalysis` section
  // was removed in 5.0. A 4.x file carrying it is dropped on load with a translation notice —
  // `Config` no longer declares the field at all.
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
