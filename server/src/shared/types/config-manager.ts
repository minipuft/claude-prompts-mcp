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
  GateSystemSettings as GatesConfig,
  ChainSessionConfig,
  ExecutionConfig,
  VersioningConfig,
  ResourcesConfig,
  TelemetryConfig,
  TransportMode,
} from './core-config.js';
import type { InjectionConfig } from './injection.js';

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

  // ── Domain config getters ────────────────────────────────────────────

  // No `getAnalysisConfig` / `getSemanticAnalysisConfig`: the deprecated
  // `analysis.semanticAnalysis` section is still parsed and defaulted at load (and warns once),
  // but nothing reads the parsed value any more — the analyzer that took it never read a field.
  getLoggingConfig(): LoggingConfig;
  getFrameworksConfig(): ResolvedFrameworkConfig;
  getGatesConfig(): GatesConfig;
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
