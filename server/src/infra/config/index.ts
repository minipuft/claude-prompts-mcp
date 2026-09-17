// @lifecycle canonical - Loads, validates, and watches MCP server configuration data.
/**
 * Configuration Management Module
 * Handles loading and validation of server configuration from config.json
 */

import { EventEmitter } from 'events';
import { watch, FSWatcher } from 'fs';
import { readFile } from 'fs/promises';
import os from 'node:os';
import path from 'path';

import { translateConfigFile } from './config-file-translation.js';
import { getParsedConfigSchema, validateConfigAgainstSchema } from './config-schema-validator.js';
import { createLogger, getDefaultLoggerConfig } from '../logging/index.js';

const logger = createLogger(
  getDefaultLoggerConfig({
    logFile: path.join(os.tmpdir(), 'config-manager.log'),
    transport: 'stdio',
    enableDebug: false,
  })
);

import type { ConfigFileTranslation } from './config-file-translation.js';
import type { ConfigFile } from '#shared/types/config-file.js';
import type {
  ConfigSchemaValidationResult,
  ConfigValueWithSource,
} from '#shared/types/config-manager.js';

import {
  Config,
  FrameworkInjectionConfig,
  LoggingConfig,
  ResolvedFrameworkConfig,
  ExecutionConfig,
  ChainSessionConfig,
  TransportMode,
  VersioningConfig,
  ResourcesConfig,
  TelemetryConfig,
  DEFAULT_VERSIONING_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
  DEFAULT_GATES_CONFIG,
  DEFAULT_INJECTION_CONFIG,
  type InjectionConfig,
  type ConfigManager,
  type GateSystemSettings,
} from '#shared/types/index.js';
import { DEFAULT_FRAMEWORK_ID } from '#shared/utils/constants.js';
// Removed: ToolDescriptionLoader import to break circular dependency
// Now injected via dependency injection pattern

/**
 * Walks a dot-path key (`"server.port"`) over an arbitrary value tree, returning the leaf or
 * `undefined` the moment a segment is missing or not an object. Same shape as the reduce-based
 * dot-walkers already used at the MCP config handler and in `cli-shared/config-operations.ts`
 * (`getConfigValue`) — reimplemented locally rather than imported, because `infra/` sits below
 * `cli-shared` in the layer model and `cli-shared`'s reader has no notion of provenance anyway.
 */
function readDotPath(root: unknown, key: string): unknown {
  let current: unknown = root;
  for (const segment of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Recursively collects the dot-path leaf keys a JSON Schema's `properties` tree declares. A
 * property carrying its own nested `properties` is a branch (walked, not listed itself);
 * everything else — string/number/boolean/array/tuple-typed leaves — is recorded as one key.
 * `$schema` is excluded: the schema declares it as an allowed property so a config file may carry
 * the editor-hint `"$schema": "./config.schema.json"`, but it is not a config key.
 */
function collectSchemaKeys(schemaNode: unknown, prefix = ''): string[] {
  if (schemaNode === null || typeof schemaNode !== 'object') return [];
  const properties = (schemaNode as { properties?: unknown }).properties;
  if (properties === null || typeof properties !== 'object') {
    return prefix ? [prefix] : [];
  }

  const keys: string[] = [];
  for (const [propKey, propSchema] of Object.entries(properties as Record<string, unknown>)) {
    if (!prefix && propKey === '$schema') continue;
    const path = prefix ? `${prefix}.${propKey}` : propKey;
    const nestedProperties = (propSchema as { properties?: unknown } | null)?.properties;
    if (nestedProperties !== null && typeof nestedProperties === 'object') {
      keys.push(...collectSchemaKeys(propSchema, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** Log levels `LOG_LEVEL` may override `logging.level` with — shared so the override check inside
 *  `getConfigValueWithSource` agrees with the one `getLoggingConfig` already applies. */
const VALID_LOG_LEVELS: string[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

/**
 * Default configuration values
 */
const DEFAULT_FRAMEWORKS_CONFIG: ResolvedFrameworkConfig = {
  dynamicToolDescriptions: true,
  // FrameworkManager and FrameworkStateStore both receive this value rather than carrying
  // their own literal, so the two cannot drift from the configured framework.
  defaultFramework: DEFAULT_FRAMEWORK_ID,
  injection: {
    systemPrompt: { enabled: true, frequency: 3, target: 'steps' },
    gateGuidance: { frequency: 0, target: 'both' },
    styleGuidance: { enabled: true, frequency: 0, target: 'steps' },
  },
};

const DEFAULT_CHAIN_SESSION_CONFIG: ChainSessionConfig = {
  sessionTimeoutMinutes: 24 * 60,
  reviewTimeoutMinutes: 30,
  cleanupIntervalMinutes: 5,
};

const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  judge: true,
};

const DEFAULT_RESOURCES_CONFIG: ResourcesConfig = {
  registerWithMcp: false, // Disabled by default - tools provide more efficient discovery
  prompts: { enabled: true },
  gates: { enabled: true },
  frameworks: { enabled: true },
  observability: {
    enabled: true,
    sessions: true,
    metrics: true,
  },
  logs: {
    enabled: true,
    maxEntries: 500,
    defaultLevel: 'info',
  },
};

/**
 * Default transport mode - STDIO for Claude Desktop/CLI compatibility
 */
const DEFAULT_TRANSPORT_MODE: TransportMode = 'stdio';

const DEFAULT_CONFIG: Config = {
  server: {
    name: 'claude-prompts',
    version: '1.0.0',
    port: 9090,
  },
  prompts: {
    directory: 'resources/prompts',
  },
  gates: DEFAULT_GATES_CONFIG,
  frameworks: DEFAULT_FRAMEWORKS_CONFIG,
  chainSessions: DEFAULT_CHAIN_SESSION_CONFIG,
  versioning: DEFAULT_VERSIONING_CONFIG,
};

/**
 * Parses the config file into a plain object, or throws.
 *
 * A top-level JSON value that is not an object (`[]`, `"text"`, `5`) is a broken config, not a
 * config with odd keys: it is rejected here, loudly, so `loadConfig`'s catch reports the path and
 * serves the defaults — rather than the old unchecked-cast path, which wrote properties onto a
 * primitive and produced a TypeError from somewhere further in.
 */
function parseConfigRecord(content: string, configPath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${configPath} must hold a JSON object at its top level.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * THE boundary between the parsed FILE and the runtime `Config` — the one place a file shape is
 * asserted, and the reason nothing below it casts again.
 *
 * This is a contract with the file, not a proof about it. The schema check that ran before it
 * REPORTS and serves (`checkAgainstSchema`): a config that fails its schema still loads, so what
 * arrives here may not match `ConfigFile` at all. That is survivable because every member of
 * `ConfigFile` except `version` is optional and {@link normalizeConfigFile} reads each one through
 * `??` against a default — a key of the wrong type resolves to the value the file holds, exactly
 * as it did before, and a key the file omits resolves to the default.
 *
 * `version` included: {@link translateConfigFile} stamps `5` onto every 4.x file it translates and
 * leaves a declared version alone, so a file carrying the WRONG version still reaches here. Nothing
 * below reads the member — the schema's `const 5` is what reports it to the operator.
 */
function asConfigFile(parsed: Record<string, unknown>): ConfigFile {
  return parsed as unknown as ConfigFile;
}

/**
 * Framework injection, read NESTED from the file.
 *
 * The 4.x file spelled this as seven flat `frameworks.*` keys that the loader reassembled into
 * three objects; the 5.0 file carries the objects, so this passes them through and defaults each
 * leaf. `systemPrompt.enabled` falls back to `frameworks.enabled` when the file does not say:
 * turning the framework system off has always turned system-prompt injection off, and the nested
 * key is the narrower, newer intent.
 */
function normalizeInjection(frameworks: ConfigFile['frameworks']): FrameworkInjectionConfig {
  const defaults = DEFAULT_FRAMEWORKS_CONFIG.injection as Required<FrameworkInjectionConfig>;
  const injection = frameworks?.injection;
  return {
    systemPrompt: {
      enabled:
        injection?.systemPrompt?.enabled ?? frameworks?.enabled ?? defaults.systemPrompt.enabled,
      frequency: injection?.systemPrompt?.frequency ?? defaults.systemPrompt.frequency,
      target: injection?.systemPrompt?.target ?? defaults.systemPrompt.target,
    },
    gateGuidance: {
      frequency: injection?.gateGuidance?.frequency ?? defaults.gateGuidance.frequency,
      target: injection?.gateGuidance?.target ?? defaults.gateGuidance.target,
    },
    styleGuidance: {
      enabled: injection?.styleGuidance?.enabled ?? defaults.styleGuidance.enabled,
      frequency: injection?.styleGuidance?.frequency ?? defaults.styleGuidance.frequency,
      target: injection?.styleGuidance?.target ?? defaults.styleGuidance.target,
    },
  };
}

/** Framework settings, with the injection block nested rather than reassembled from flat keys. */
function normalizeFrameworks(file: ConfigFile): Config['frameworks'] {
  const frameworks = file.frameworks;
  return {
    enabled: frameworks?.enabled ?? true,
    dynamicToolDescriptions:
      frameworks?.dynamicToolDescriptions ?? DEFAULT_FRAMEWORKS_CONFIG.dynamicToolDescriptions,
    defaultFramework: frameworks?.defaultFramework ?? DEFAULT_FRAMEWORKS_CONFIG.defaultFramework,
    injection: normalizeInjection(frameworks),
  };
}

/**
 * Chain session lifetimes, read from the file's ROOT `chainSessions`.
 *
 * The rename the mapping makes visible: the file says `timeoutMinutes`, the runtime reads
 * `sessionTimeoutMinutes`. A cast could not have caught that; this signature does.
 */
function normalizeChainSessions(file: ConfigFile): ChainSessionConfig {
  const sessions = file.chainSessions;
  return {
    sessionTimeoutMinutes:
      sessions?.timeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.sessionTimeoutMinutes,
    reviewTimeoutMinutes:
      sessions?.reviewTimeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.reviewTimeoutMinutes,
    cleanupIntervalMinutes:
      sessions?.cleanupIntervalMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.cleanupIntervalMinutes,
  };
}

/**
 * Gates, carried across key by key and NOT defaulted here.
 *
 * `getGatesConfig()` owns this section's defaults, at read time — which is what lets
 * `getConfigValueWithSource` report an unset gates key as `'deferred'` rather than inventing a
 * value for it. The old wire-to-internal rename that used to live in that getter (the gate
 * definitions-directory field on the internal settings shape) is gone (row 4.7, field deleted row
 * 4.12): the directory is resolved by `getGatesDirectory()`, and nothing ever read the field the
 * old rename produced.
 */
function normalizeGates(file: ConfigFile): Config['gates'] {
  const gates = file.gates;
  if (gates === undefined) return undefined;
  return {
    enabled: gates.enabled,
    directory: gates.directory,
    frameworkGates: gates.frameworkGates,
    executeInlineGateDefinitions: gates.executeInlineGateDefinitions,
    evaluation: gates.evaluation,
    harnessCovers: gates.harnessCovers,
    reminderTokenBudget: gates.reminderTokenBudget,
  };
}

/**
 * Phase guards, carried across only when the file sets the section.
 *
 * The two leaf defaults are the ones every reader already falls back to when the section is absent
 * (`pipeline-builder.ts`, `19-phase-guard-verification-stage.ts`), applied here so a half-set
 * section resolves to a number rather than to `undefined` — that stage computes
 * `maxRetries + 1`.
 */
function normalizePhaseGuards(file: ConfigFile): Config['phaseGuards'] {
  const phaseGuards = file.phaseGuards;
  if (phaseGuards === undefined) return undefined;
  return { mode: phaseGuards.mode ?? 'enforce', maxRetries: phaseGuards.maxRetries ?? 2 };
}

/**
 * Logging, carried across only when the file sets the section — `getLoggingConfig()` owns the
 * absent case, with the same two values used here for a half-set one.
 */
function normalizeLogging(file: ConfigFile): Config['logging'] {
  const logging = file.logging;
  if (logging === undefined) return undefined;
  return { directory: logging.directory ?? './logs', level: logging.level ?? 'info' };
}

/** MCP resource toggles, carried across; `getResourcesConfig()` owns their defaults. */
function normalizeResources(file: ConfigFile): Config['resources'] {
  const resources = file.resources;
  if (resources === undefined) return undefined;
  return {
    registerWithMcp: resources.registerWithMcp,
    prompts: resources.prompts,
    gates: resources.gates,
    frameworks: resources.frameworks,
    observability: resources.observability,
    logs: resources.logs,
  };
}

/**
 * Versioning, reading the camelCase spelling the 5.0 file declares.
 *
 * The rename the mapping makes visible, same class as `chainSessions`: the file says `maxVersions`,
 * the runtime reads `max_versions`. A 4.x file spelling that pair snake_case is folded into the
 * camelCase one by {@link translateConfigFile} before it reaches here, so there is one spelling per
 * concept at this point rather than two read in precedence order.
 */
function normalizeVersioning(file: ConfigFile): VersioningConfig {
  const versioning = file.versioning;
  return {
    enabled: versioning?.enabled ?? DEFAULT_VERSIONING_CONFIG.enabled,
    max_versions: versioning?.maxVersions ?? DEFAULT_VERSIONING_CONFIG.max_versions,
    auto_version: versioning?.autoVersion ?? DEFAULT_VERSIONING_CONFIG.auto_version,
  };
}

/** Telemetry, merged over the safe defaults — the same fold the loader has always applied. */
function normalizeTelemetry(file: ConfigFile): TelemetryConfig {
  const telemetry = file.telemetry;
  return {
    ...DEFAULT_TELEMETRY_CONFIG,
    ...telemetry,
    attributePolicy: {
      ...DEFAULT_TELEMETRY_CONFIG.attributePolicy,
      ...telemetry?.attributePolicy,
    },
  };
}

/**
 * Maps a config FILE onto the resolved runtime `Config`. The one function that crosses that
 * boundary, and the reason the loader no longer casts one shape to the other.
 *
 * Pure: its inputs are the file and this module's `DEFAULT_*` constants, and it mutates neither.
 * Sections this loader has never defaulted at load time (`gates`, `resources`, `logging`,
 * `identity`, `verification`, `phaseGuards`) are carried across only when the file sets them, so
 * an absent key stays absent and its OWNING getter still applies the default at read time —
 * `getConfigValueWithSource` depends on that distinction to label a value `'deferred'` rather than
 * `'default'`.
 *
 * Keys the file may carry that the runtime `Config` has no member for at all — `hooks`, read by
 * the Python hooks straight off the file — are not carried across. `server.transport` is not among
 * them any more: a value other than `"stdio"` is refused before this runs (Ruling R30, transport is
 * launch-time-only), and the harmless spelling is dropped by {@link translateConfigFile}, so no
 * `transport` key survives to reach this mapping.
 *
 * `Config.analysis` is left unset on purpose. The section is no longer a config key at all: a 4.x
 * file carrying it has it dropped, with a notice naming the replacement.
 */
function normalizeConfigFile(file: ConfigFile): Config {
  return {
    server: {
      name: file.server?.name ?? DEFAULT_CONFIG.server.name,
      // Not a file key: the server's own version is the package's, never an operator's choice.
      version: DEFAULT_CONFIG.server.version,
      port: file.server?.port ?? DEFAULT_CONFIG.server.port,
    },
    prompts: {
      directory: file.prompts?.directory ?? DEFAULT_CONFIG.prompts.directory,
      registerWithMcp: file.prompts?.registerWithMcp,
    },
    gates: normalizeGates(file),
    phaseGuards: normalizePhaseGuards(file),
    execution: { judge: file.execution?.judge ?? DEFAULT_EXECUTION_CONFIG.judge ?? true },
    frameworks: normalizeFrameworks(file),
    chainSessions: normalizeChainSessions(file),
    logging: normalizeLogging(file),
    versioning: normalizeVersioning(file),
    verification: file.verification,
    resources: normalizeResources(file),
    telemetry: normalizeTelemetry(file),
    identity: file.identity,
  };
}

/** A 5.0 file that declares nothing: what a missing or unreadable config resolves to. */
const EMPTY_CONFIG_FILE: ConfigFile = { version: 5 };

/**
 * A config file that asks for a transport other than `"stdio"` via `server.transport`.
 *
 * Transport is launch-time-only (Ruling R30) — only `--transport` selects it, and `Config` carries
 * no `transport` member for a value here to reach. Unlike an ordinary schema mismatch (which
 * `checkAgainstSchema` reports and the server runs past, since most typos do not change what the
 * process is actually doing), a non-`"stdio"` `server.transport` describes an explicit operator
 * request the server CANNOT satisfy from config: starting anyway would silently serve stdio while
 * the operator believes they configured HTTP. That asymmetry is why this refuses instead of warns.
 */
export class TransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportConfigError';
  }
}

/**
 * Refuses a raw parsed config file whose `server.transport` names anything but `"stdio"`.
 *
 * Runs against the RAW parsed record, BEFORE {@link translateConfigFile}: the translation drops
 * `server.transport` outright, so a check placed after it would see nothing and a 4.x file asking
 * for HTTP would start on stdio in silence. Refusing first is what keeps that operator request
 * answered — with the flag that satisfies it — rather than translated away.
 *
 * A `server.transport` left at `"stdio"` (or omitted) needs no report at all: the translation drops
 * it as a key 5.0 removed, and names it in the one translation notice.
 */
function assertServerTransportIsStdio(
  rawConfig: Record<string, unknown>,
  configPath: string
): void {
  const server = rawConfig['server'];
  if (server === null || typeof server !== 'object' || Array.isArray(server)) return;

  const transportValue = (server as Record<string, unknown>)['transport'];
  if (transportValue === undefined || transportValue === 'stdio') return;

  throw new TransportConfigError(
    `${configPath} sets "server.transport": ${JSON.stringify(transportValue)}, but transport is a ` +
      'launch-time-only setting — config can no longer select it. Remove ' +
      '"server.transport" from the config file and launch the server with ' +
      '--transport=streamable-http (or --transport=both) instead.'
  );
}

/**
 * Configuration manager class
 */
/**
 * The path-resolution surface `ConfigLoader` needs, expressed structurally.
 *
 * `PathResolver` lives in `runtime/` and `infra/` (Layer 1) may import only `shared/`, so this is
 * a port rather than an import — the shape the arch rules prescribe ("shared/types interfaces +
 * constructor injection"). `runtime/context.ts` satisfies it by passing the live PathResolver.
 *
 * One member per resource type this loader resolves a directory for. Reads already go through
 * `PathResolver` for prompts, gates, frameworks and styles alike; these members exist so writes
 * agree with them (D8 Arc 1).
 */
export interface ResourcePathSource {
  getPromptsPath(): string;
  getGatesPath(): string;
  getFrameworksPath(): string;
  getScriptsPath(): string;
  getStylesPath(): string;
  /**
   * The bundled (package-shipped) directory for a resource type — the lowest-precedence root,
   * always read, never written.
   *
   * Writers need it to answer "where does this resource live TODAY", which is a different
   * question from "where would a write go" and has a different answer whenever a personal library
   * is configured. Without it a framework served from the bundle read as absent to its own
   * updater, which reported `Files may be corrupted` (P1.2).
   */
  getBundledResourceDir(resourceType: string): string;
  /**
   * Workspace overlay directories for a resource type, highest precedence, read in order.
   *
   * On the port for the same reason `getBundledResourceDir` is: the RELOAD path needs the same
   * root SET startup uses, and it lives in `modules/` where `runtime/PathResolver` cannot be
   * imported. Without it, reload could only ever see one directory.
   */
  getOverlayResourceDirs(resourceType: string, primaryDir?: string): string[];
}

export class ConfigLoader extends EventEmitter implements ConfigManager {
  private config: Config;
  private configPath: string;
  // Removed: private toolDescriptionLoader - now injected via dependency injection
  private fileWatcher: FSWatcher | undefined;
  private watching: boolean = false;
  private reloadDebounceTimer: NodeJS.Timeout | undefined;
  private frameworksConfigCache: ResolvedFrameworkConfig;
  /** Translation notices are per-process, not per-load — file watching re-enters `loadConfig`. */
  private warnedTranslation = false;
  /**
   * The package's own `config.schema.json`, injected by the composition root. Never read from the
   * config's `$schema`, which is an editor hint. Undefined means the file is not schema-checked.
   */
  private readonly schemaPath: string | undefined;
  /** The schema check of the last successful parse; undefined when none ran or the load failed. */
  private schemaValidation: ConfigSchemaValidationResult | undefined;
  /**
   * Status + errors of the last result that WARNED. Unlike `warnedTranslation` this is not
   * once-per-process: hot reload re-enters `loadConfig`, so an unchanged file must stay quiet while
   * a new mistake must still be reported. Cleared by a valid load, so a reintroduced error warns.
   */
  private lastWarnedSchemaSignature: string | undefined;
  /**
   * A snapshot of the config FILE as the rest of the process sees it — the 5.0 shape, after
   * {@link translateConfigFile}. Without this copy nothing distinguishes "the file set this key"
   * from "the loader defaulted it". Undefined when no file has been successfully parsed
   * (constructed but never loaded, or the last `loadConfig` fell back to the defaults). Read only
   * by `getConfigValueWithSource`.
   */
  private rawFileConfig: Record<string, unknown> | undefined;
  /**
   * The transport the process was launched with, as resolved by `TransportRouter.determineTransport`.
   * Defaults to `DEFAULT_TRANSPORT_MODE` until `setTransportMode` runs, which matches
   * `determineTransport`'s own default when no `--transport` flag is present — so a reader that
   * calls `getTransportMode()` before startup finishes still gets the same answer startup would
   * have produced. See {@link ConfigLoader.getTransportMode} for why this is a stored value now
   * instead of a re-scan of the process's own command-line arguments.
   */
  private transportMode: TransportMode = DEFAULT_TRANSPORT_MODE;

  constructor(
    configPath: string,
    private readonly resourcePaths?: ResourcePathSource,
    options: { readonly schemaPath?: string } = {}
  ) {
    super();
    this.configPath = configPath;
    this.config = DEFAULT_CONFIG;
    this.frameworksConfigCache = { ...DEFAULT_FRAMEWORKS_CONFIG };
    this.schemaPath = options.schemaPath;
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<Config> {
    const previousFrameworks = { ...this.frameworksConfigCache };
    try {
      const configContent = await readFile(this.configPath, 'utf8');
      const parsedRecord = parseConfigRecord(configContent, this.configPath);

      // Refuses before anything below reads, watches or normalizes this file: a `server.transport`
      // other than "stdio" can never take effect (transport is launch-time-only, Ruling R30), so
      // continuing would silently ignore an explicit operator request instead of naming
      // --transport as the fix.
      assertServerTransportIsStdio(parsedRecord, this.configPath);

      // A file that declares no `version` was written against the 4.x shape: it is translated here,
      // in memory, and everything below reads one shape. `version: 5` (or any other declared
      // value) passes through untouched.
      const translation = translateConfigFile(parsedRecord);
      this.warnConfigFileTranslated(translation);

      // Checked against the TRANSLATED file, not the raw one (ruling R33): a 4.x key the
      // translation handled is not drift the operator has to act on, and reporting it would tell
      // them to fix a file the server just read correctly. What the schema still reports is what
      // the translation could NOT account for — a typo, or a key from no shape at all.
      await this.checkAgainstSchema(translation.file);

      // Snapshot of the translated file, which is the shape every reader below sees — so
      // `getConfigValueWithSource` labels a user's 4.x key `'file'` under its 5.0 name rather than
      // under a spelling nothing else in the process uses.
      this.rawFileConfig = structuredClone(translation.file);

      const file = asConfigFile(translation.file);

      this.config = normalizeConfigFile(file);

      this.emitConfigChange(previousFrameworks);

      return this.config;
    } catch (error) {
      // A refused transport setting is an operator error with a complete explanation, not a file
      // the server failed to read — propagate it rather than falling back to defaults, or the
      // fallback would silently start the server on the transport the operator refused.
      if (error instanceof TransportConfigError) throw error;

      // Whatever the last check said describes a file this load did not serve.
      this.schemaValidation = undefined;
      this.rawFileConfig = undefined;
      console.error(`Error loading configuration from ${this.configPath}:`, error);
      // stderr, not stdout: on STDIO stdout is the protocol channel, and a stray line corrupts it.
      console.error('Using default configuration');
      // The same mapping a real file goes through, fed a file that declares nothing — so the
      // fallback config cannot drift from what an empty config.json resolves to.
      this.config = normalizeConfigFile(EMPTY_CONFIG_FILE);
      this.emitConfigChange(previousFrameworks);
      return this.config;
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * The schema check of the last successful parse. Undefined means NOT VALIDATED — no schema path
   * was injected, or the last load fell back to defaults — and must never be read as valid.
   */
  getSchemaValidation(): ConfigSchemaValidationResult | undefined {
    return this.schemaValidation;
  }

  /**
   * The effective value of a dot-path key and which layer produced it.
   *
   * `server.port` and `logging.level` are special-cased ahead of the file/default walk because
   * both have a live environment override (`PORT`, `LOG_LEVEL`) that a generic dot-walk over
   * `getConfig()` cannot see — `getPort()` and `getLoggingConfig()` already resolve the override,
   * so this defers to them and reports `'environment'` only when the override actually applied
   * (an unset or invalid env var falls through to the file/default walk below, same as those
   * getters already do).
   *
   * Below that: `'file'` when the raw file set it, `'default'` when the file didn't but
   * `normalizeConfigFile` resolved a real value at load time, and `'deferred'` — see
   * {@link ConfigValueSource} — when neither did, because the key's section is one this loader
   * never writes back and only its owning getter defaults at read time.
   */
  getConfigValueWithSource(key: string): ConfigValueWithSource {
    if (key === 'server.port' && process.env['PORT']) {
      // Same truthy check `getPort()` applies internally — an empty-string `PORT` is "unset" to
      // that getter too, and reporting `'environment'` here must agree with what it returns.
      return { key, value: this.getPort(), source: 'environment' };
    }
    if (key === 'logging.level') {
      const envLogLevel = process.env['LOG_LEVEL'];
      if (envLogLevel && VALID_LOG_LEVELS.includes(envLogLevel.toUpperCase())) {
        return { key, value: this.getLoggingConfig().level, source: 'environment' };
      }
    }

    // `value` always comes from the EFFECTIVE merged config, never from the raw file: a key
    // `normalizeConfigFile` does not carry across is replaced by the default (e.g. `server.name`
    // when the file's `server` is falsy), so a raw value can be present on disk while the process
    // runs on the default that replaced it.
    // Reporting the raw value there would be exactly the false-confidence case this method exists
    // to end. `rawFileConfig` therefore decides only whether the SOURCE LABEL is `'file'`.
    const rawValue = readDotPath(this.rawFileConfig, key);
    const mergedValue = readDotPath(this.config, key);

    if (rawValue !== undefined) {
      // The snapshot is post-translation, so a 4.x spelling the operator wrote is present here
      // under its 5.0 name and nowhere else — the legacy-spelling case this fallback used to
      // exist for (`gates.mode` present raw, `undefined` merged) can no longer arise.
      // What remains is the narrower one it also always covered: a key the runtime `Config` has
      // no member for at all — `hooks.expandedOutput`, read by the Python hooks straight off the
      // file. The file set it, so reporting `undefined` would show a live setting as unset.
      return { key, value: mergedValue !== undefined ? mergedValue : rawValue, source: 'file' };
    }

    // Neither the file nor `normalizeConfigFile` produced a value: `gates`, `resources`,
    // `logging`, `identity`, `verification`, `phaseGuards` and `hooks` are carried across only
    // when the file sets them (unlike `server`/`prompts`/`analysis`/`frameworks`/`chainSessions`/
    // `execution`/`versioning`/`telemetry`, which always resolve to a concrete value here), so a
    // key living in one of those sections stays genuinely absent from `this.config` until its
    // OWNING getter
    // applies a default at read time (e.g. `gates.enabled` inside `getGatesConfig()`). Reporting
    // `'default'` with an `undefined` value here would be indistinguishable from a default that IS
    // `undefined` by design (`getPromptsRegisterWithMcp()`, `telemetry.attributePolicy.allowlist`)
    // — exactly the false-confidence case `getConfigValueWithSource` exists to end. `'deferred'`
    // names the state honestly instead of guessing at a value no layer has produced yet.
    if (mergedValue === undefined) {
      return { key, value: undefined, source: 'deferred' };
    }

    return { key, value: mergedValue, source: 'default' };
  }

  /**
   * The dot-path keys the packaged `config.schema.json` declares. Reads the parsed schema through
   * `getParsedConfigSchema` (`config-schema-validator.ts`), the same mtime-keyed cache entry the
   * compiled AJV validator is drawn from — one read, one parse, one invalidation rule shared by
   * both consumers, instead of this method re-reading and re-parsing the file on every call.
   *
   * Rejects rather than returning an empty array: no schema path, an unreadable file, and invalid
   * JSON are all "cannot enumerate", never "zero keys declared" — `getParsedConfigSchema` throws
   * on the latter two, and this wraps that failure with the schema path for context.
   */
  async listConfigKeys(): Promise<string[]> {
    if (this.schemaPath === undefined) {
      throw new Error(
        'listConfigKeys: no config schema path was injected; cannot enumerate config keys.'
      );
    }

    let schema: unknown;
    try {
      schema = await getParsedConfigSchema(this.schemaPath);
    } catch (error) {
      throw new Error(
        `listConfigKeys: could not load the config schema at ${this.schemaPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }

    return collectSchemaKeys(schema);
  }

  /**
   * Get server configuration
   */
  getServerConfig() {
    return this.config.server;
  }

  /**
   * Get prompts configuration
   */
  getPromptsConfig() {
    return this.config.prompts;
  }

  /**
   * Get global registerWithMcp default from prompts config
   * Returns undefined if not specified (allowing downstream defaults)
   */
  getPromptsRegisterWithMcp(): boolean | undefined {
    return this.config.prompts?.registerWithMcp;
  }

  /**
   * The transport the process was launched with.
   *
   * Transport is launch-time-only since Ruling R30: `Config` carries no `transport` member (the
   * config file cannot select it — `loadConfig` refuses a `server.transport` other than
   * `"stdio"` outright, see {@link assertServerTransportIsStdio}), so there is nothing on
   * `this.config` to read. Row 4.12: this used to re-derive the answer by scanning the process's
   * own command-line arguments for the `--transport` flag itself, which is a second, independent
   * parse of the same flag `runtime/cli.ts`'s `parseServerCliArgs` already owns — and one that
   * only recognized the `key=value`-joined spelling of the flag, so the space-separated form
   * silently resolved to `stdio` here while `TransportRouter.determineTransport` (once fixed the
   * same way) and `resolveRuntimeLaunchOptions`'s auto-quiet decision agreed it meant HTTP. There
   * is now exactly one parse of `--transport` per process (`parseServerCliArgs`, called once by
   * `resolveRuntimeLaunchOptions`); this getter just returns the value `setTransportMode` was
   * given, which `runtime/application.ts` calls once, from the SAME resolution
   * `TransportRouter.determineTransport` produced for the transport the server actually serves —
   * so a caller holding only a `ConfigManager` (no direct access to CLI args, e.g. the
   * identity-resolution closure in `pipeline-builder.ts`) reads the identical answer.
   */
  getTransportMode(): TransportMode {
    return this.transportMode;
  }

  /**
   * Records the transport the process resolved to, so {@link getTransportMode} needs no view of
   * the process's own command-line arguments. Called exactly once, by `runtime/application.ts`,
   * right after `TransportRouter.determineTransport` has produced the value the server is
   * actually serving on — never called with anything else, so `getTransportMode()` cannot
   * disagree with the transport in use.
   */
  setTransportMode(transport: TransportMode): void {
    this.transportMode = transport;
  }

  /**
   * Get logging configuration with environment variable override
   * Supports LOG_LEVEL env var to override configured log level
   */
  getLoggingConfig(): LoggingConfig {
    const defaultLogging: LoggingConfig = {
      directory: './logs',
      level: 'info',
    };

    const configLogging = this.config.logging || defaultLogging;

    // Override log level from LOG_LEVEL environment variable if present
    const envLogLevel = process.env['LOG_LEVEL'];
    if (envLogLevel) {
      const normalizedLevel = envLogLevel.toUpperCase();

      if (VALID_LOG_LEVELS.includes(normalizedLevel)) {
        return {
          ...configLogging,
          level: normalizedLevel.toLowerCase(), // Normalize to lowercase for consistency
        };
      } else {
        // Invalid LOG_LEVEL - warn but continue with config value
        const validLevelsStr = VALID_LOG_LEVELS.join(', ');
        console.warn(
          `Invalid LOG_LEVEL environment variable: "${envLogLevel}". ` +
            `Valid levels: ${validLevelsStr}. Using configured level: "${configLogging.level}"`
        );
      }
    }

    return configLogging;
  }

  /**
   * Get frameworks configuration (includes injection settings)
   * Reads from frameworks config section
   */
  getFrameworksConfig(): ResolvedFrameworkConfig {
    const frameworks = this.config.frameworks;
    return {
      dynamicToolDescriptions:
        frameworks?.dynamicToolDescriptions ?? DEFAULT_FRAMEWORKS_CONFIG.dynamicToolDescriptions,
      defaultFramework: frameworks?.defaultFramework ?? DEFAULT_FRAMEWORKS_CONFIG.defaultFramework,
      // Already nested and fully defaulted by `normalizeInjection`; the fallback covers a manager
      // asked for its config before its first load.
      injection: frameworks?.injection ?? DEFAULT_FRAMEWORKS_CONFIG.injection,
    };
  }

  /**
   * Get gates configuration (unified gate settings)
   * Reads from gates config section with new property names
   */
  getGatesConfig(): GateSystemSettings {
    const gatesConfig = this.config.gates ?? {};
    return {
      enabled: gatesConfig.enabled ?? DEFAULT_GATES_CONFIG.enabled,
      enableFrameworkGates: gatesConfig.frameworkGates ?? DEFAULT_GATES_CONFIG.enableFrameworkGates,
      executeInlineGateDefinitions:
        gatesConfig.executeInlineGateDefinitions ??
        DEFAULT_GATES_CONFIG.executeInlineGateDefinitions,
      harnessCovers: gatesConfig.harnessCovers ?? DEFAULT_GATES_CONFIG.harnessCovers,
      reminderTokenBudget:
        gatesConfig.reminderTokenBudget ?? DEFAULT_GATES_CONFIG.reminderTokenBudget,
    };
  }

  /**
   * Get chain session lifecycle configuration
   * Reads from the root `chainSessions` config section
   */
  getChainSessionConfig(): ChainSessionConfig {
    const sessions = this.config.chainSessions;
    return {
      sessionTimeoutMinutes:
        sessions?.sessionTimeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.sessionTimeoutMinutes,
      reviewTimeoutMinutes:
        sessions?.reviewTimeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.reviewTimeoutMinutes,
      cleanupIntervalMinutes:
        sessions?.cleanupIntervalMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.cleanupIntervalMinutes,
    };
  }

  /**
   * Get execution strategy configuration
   */
  getExecutionConfig(): ExecutionConfig {
    const judgeValue = this.config.execution?.judge;
    if (judgeValue !== undefined) {
      return { judge: judgeValue };
    }
    return { judge: DEFAULT_EXECUTION_CONFIG.judge ?? true };
  }

  /**
   * Get judge enabled status (convenience method)
   */
  isJudgeEnabled(): boolean {
    return this.getExecutionConfig().judge ?? true;
  }

  /**
   * Get versioning configuration for resource history tracking
   */
  getVersioningConfig(): VersioningConfig {
    const versioningConfig: Partial<VersioningConfig> = this.config.versioning ?? {};
    return {
      enabled: versioningConfig.enabled ?? DEFAULT_VERSIONING_CONFIG.enabled,
      max_versions: versioningConfig.max_versions ?? DEFAULT_VERSIONING_CONFIG.max_versions,
      auto_version: versioningConfig.auto_version ?? DEFAULT_VERSIONING_CONFIG.auto_version,
    };
  }

  /**
   * Get MCP resources configuration
   */
  getResourcesConfig(): ResourcesConfig {
    const cfg = this.config.resources ?? {};
    const def = DEFAULT_RESOURCES_CONFIG;
    return {
      registerWithMcp: cfg.registerWithMcp ?? def.registerWithMcp,
      prompts: {
        enabled: cfg.prompts?.enabled ?? def.prompts?.enabled ?? true,
      },
      gates: {
        enabled: cfg.gates?.enabled ?? def.gates?.enabled ?? true,
      },
      frameworks: {
        enabled: cfg.frameworks?.enabled ?? def.frameworks?.enabled ?? true,
      },
      observability: {
        enabled: cfg.observability?.enabled ?? def.observability?.enabled ?? true,
        sessions: cfg.observability?.sessions ?? def.observability?.sessions ?? true,
        metrics: cfg.observability?.metrics ?? def.observability?.metrics ?? true,
      },
      logs: {
        enabled: cfg.logs?.enabled ?? def.logs?.enabled ?? true,
        maxEntries: cfg.logs?.maxEntries ?? def.logs?.maxEntries ?? 500,
        defaultLevel: cfg.logs?.defaultLevel ?? def.logs?.defaultLevel ?? 'info',
      },
    };
  }

  /**
   * Get OpenTelemetry configuration with safe defaults.
   */
  getTelemetryConfig(): TelemetryConfig {
    const cfg: Partial<TelemetryConfig> = this.config.telemetry ?? {};
    return {
      enabled: cfg.enabled ?? DEFAULT_TELEMETRY_CONFIG.enabled,
      mode: cfg.mode ?? DEFAULT_TELEMETRY_CONFIG.mode,
      exporterEndpoint: cfg.exporterEndpoint ?? DEFAULT_TELEMETRY_CONFIG.exporterEndpoint,
      samplingRate: cfg.samplingRate ?? DEFAULT_TELEMETRY_CONFIG.samplingRate,
      attributePolicy: {
        businessContext:
          cfg.attributePolicy?.businessContext ??
          DEFAULT_TELEMETRY_CONFIG.attributePolicy.businessContext,
        rawCommands:
          cfg.attributePolicy?.rawCommands ?? DEFAULT_TELEMETRY_CONFIG.attributePolicy.rawCommands,
        rawResponses:
          cfg.attributePolicy?.rawResponses ??
          DEFAULT_TELEMETRY_CONFIG.attributePolicy.rawResponses,
        allowlist: cfg.attributePolicy?.allowlist,
      },
    };
  }

  /**
   * Get injection config for the internal InjectionDecisionService.
   * Translates from the user-friendly frameworks.injection format to the internal format.
   */
  getInjectionConfig(): InjectionConfig {
    const frameworksConfig = this.getFrameworksConfig();
    const inj = frameworksConfig.injection;

    // Translate frequency number to InjectionFrequency:
    // 0 → first-only, N>0 → every N steps
    const toFrequency = (
      n: number | undefined,
      fallbackMode: 'first-only' | 'every',
      fallbackInterval?: number
    ): { mode: 'every' | 'first-only'; interval?: number } => {
      if (n === undefined)
        return fallbackInterval
          ? { mode: fallbackMode, interval: fallbackInterval }
          : { mode: fallbackMode };
      if (n === 0) return { mode: 'first-only' as const };
      return { mode: 'every' as const, interval: n };
    };

    const injectionDefaults =
      DEFAULT_FRAMEWORKS_CONFIG.injection as Required<FrameworkInjectionConfig>;
    const systemPromptEnabled =
      inj?.systemPrompt?.enabled ?? injectionDefaults.systemPrompt.enabled;
    // `Required<T>` only lifts top-level optionality; `styleGuidance.enabled` stays `boolean |
    // undefined` in the type even though the literal below always sets it — the trailing `?? true`
    // is a type-narrowing safety net that can never actually fire, not a second default to drift.
    const styleEnabled =
      inj?.styleGuidance?.enabled ?? injectionDefaults.styleGuidance.enabled ?? true;
    const gatesEnabled = this.getGatesConfig().enabled;

    return {
      defaults: {
        'system-prompt': systemPromptEnabled,
        'gate-guidance': gatesEnabled,
        'style-guidance': styleEnabled,
      },
      'system-prompt': {
        enabled: systemPromptEnabled,
        frequency: toFrequency(
          inj?.systemPrompt?.frequency,
          'every',
          injectionDefaults.systemPrompt.frequency
        ),
        target: inj?.systemPrompt?.target ?? injectionDefaults.systemPrompt.target,
      },
      'gate-guidance': {
        ...DEFAULT_INJECTION_CONFIG['gate-guidance'],
        enabled: gatesEnabled,
        frequency: toFrequency(inj?.gateGuidance?.frequency, 'first-only'),
        target: inj?.gateGuidance?.target ?? injectionDefaults.gateGuidance.target,
      },
      'style-guidance': {
        ...DEFAULT_INJECTION_CONFIG['style-guidance'],
        enabled: styleEnabled,
        frequency: toFrequency(inj?.styleGuidance?.frequency, 'first-only'),
        target: inj?.styleGuidance?.target ?? injectionDefaults.styleGuidance.target,
      },
    };
  }

  /**
   * Get the port number, with environment variable override
   */
  getPort(): number {
    return process.env['PORT'] ? parseInt(process.env['PORT'], 10) : this.config.server.port;
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get prompts directory path (for YAML-based prompt discovery)
   */
  getPromptsDirectory(): string {
    const configDir = path.dirname(this.configPath);
    return path.join(configDir, this.config.prompts.directory);
  }

  /**
   * Resolve prompts directory path — the destination every prompt WRITE resolves through.
   *
   * Priority:
   *   1. overridePath parameter
   *   2. the injected `PromptsPathSource` (PathResolver), i.e. the same chain reads use
   *   3. config.prompts.directory, resolved against the config file's directory
   *
   * Step 2 is the whole point. This method used to stop at step 3, which meant reads resolved
   * through PathResolver (`MCP_RESOURCES_PATH` -> `MCP_WORKSPACE` -> package default) while writes
   * resolved against the config file alone. Setting `MCP_RESOURCES_PATH` therefore moved every
   * read and no write: prompts were served from the override and edits landed back in the
   * package's own `resources/prompts`. The two only ever agreed because the shipped
   * `config.prompts.directory` happens to name the same path the default resolution produces.
   *
   * Step 3 remains as the fallback for callers constructed without a resolver (tests, the CLI's
   * throwaway loader), so behaviour there is unchanged.
   */
  getResolvedPromptsDirectory(overridePath?: string): string {
    const baseDir = path.dirname(this.configPath);

    if (overridePath !== undefined) {
      return path.isAbsolute(overridePath) ? overridePath : path.resolve(baseDir, overridePath);
    }

    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getPromptsPath();
    }

    const configured = this.getPromptsDirectory();
    return path.isAbsolute(configured) ? configured : path.resolve(baseDir, configured);
  }

  /**
   * Get server root directory path
   */
  getServerRoot(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Get frameworks directory path — the destination every framework WRITE and DELETE resolves
   * through (`framework-file-writer.ts:504`, via `getFrameworkDir`).
   *
   * Third instance of the same defect as prompts and gates: `getFrameworkDir` composed
   * `join(getServerRoot(), 'resources', 'frameworks', id)`, so it ignored `PathResolver` while
   * framework reads were overlay-merged through it (`module-initializer.ts:218`). The delete path
   * makes this sharper than the other two — `rm(frameworkDir, {recursive: true})` against a
   * mis-resolved root removes a directory in the package tree.
   */
  getFrameworksDirectory(): string {
    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getFrameworksPath();
    }

    const configDir = path.dirname(this.configPath);
    return path.join(configDir, 'resources', 'frameworks');
  }

  /**
   * The bundled directory for a resource type, or undefined when no path source is injected.
   *
   * Undefined rather than a guessed fallback: the only honest answer without a `PathResolver` is
   * "unknown", and a guess here would send a copy-on-write reading files from the wrong tree.
   * Every caller treats undefined as "no distinct bundled source", which degrades to the
   * pre-existing behaviour rather than to a wrong one.
   */
  getBundledResourceDirectory(resourceType: string): string | undefined {
    return this.resourcePaths?.getBundledResourceDir(resourceType);
  }

  /**
   * The workspace overlay directories for a resource type, or `[]` when no path source is injected.
   *
   * Empty rather than undefined: "no overlays" and "cannot resolve overlays" produce the same
   * correct behaviour here — load nothing extra — and a caller that had to distinguish them would
   * be deciding something this method does not know.
   */
  getOverlayResourceDirectories(resourceType: string, primaryDir?: string): string[] {
    return this.resourcePaths?.getOverlayResourceDirs(resourceType, primaryDir) ?? [];
  }

  /**
   * Get gates directory path (for gate definitions) — the destination every gate WRITE resolves
   * through (`gate-file-writer.ts:135`, `gate-lifecycle-processor.ts:202,280`).
   *
   * Same defect prompts had (see `getResolvedPromptsDirectory`), one degree worse: this did not
   * merely stop short of `PathResolver`, it hardcoded `resources/gates` and consulted neither the
   * config file nor the environment. Gate reads DO go through `PathResolver` and are overlay-merged
   * (`module-initializer.ts:199`), so `MCP_RESOURCES_PATH` moved every gate read and no gate write.
   */
  getGatesDirectory(): string {
    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getGatesPath();
    }

    const configDir = path.dirname(this.configPath);
    return path.join(configDir, 'resources', 'gates');
  }

  /**
   * Get scripts directory path — the primary root `WorkspaceScriptLoader` searches after
   * prompt-local scripts, for `{{script:id}}` references (`prompt-executor.ts`).
   *
   * Fourth instance of the prompts/gates/frameworks defect: this loader built its search
   * directory from `getServerRoot()` directly, so it read the package tree even with a
   * workspace configured — the read side never went through `PathResolver` at all, prompts'
   * starting point before D8 Arc 1.
   */
  getScriptsDirectory(): string {
    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getScriptsPath();
    }

    const configDir = path.dirname(this.configPath);
    return path.join(configDir, 'resources', 'scripts');
  }

  /**
   * Get styles directory path — the primary root `StyleManager` resolves `#style` references
   * against (`prompt-executor.ts`). Same defect and fix as {@link getScriptsDirectory}.
   */
  getStylesDirectory(): string {
    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getStylesPath();
    }

    const configDir = path.dirname(this.configPath);
    return path.join(configDir, 'resources', 'styles');
  }

  // Removed: ToolDescriptionLoader methods - now handled via dependency injection in runtime/application.ts

  /**
   * Emit the 4.x -> 5.0 translation notice at most once per process.
   *
   * Fires only when the translation actually moved or dropped something — a 4.x file whose every
   * key is already spelled the 5.0 way has nothing for the operator to act on, and a `version: 5`
   * file is never translated at all, so both stay silent. Once per process, not once per load:
   * file watching re-enters `loadConfig`, and a notice that repeats per reload becomes noise the
   * operator filters out, which is how a deprecation goes unread.
   *
   * Names every pair and every dropped key rather than summarising: the operator's next act is to
   * rewrite `config.json`, and a count tells them nothing about which lines to change.
   */
  private warnConfigFileTranslated(translation: ConfigFileTranslation): void {
    if (this.warnedTranslation) return;
    if (translation.translated.length === 0 && translation.dropped.length === 0) return;
    this.warnedTranslation = true;

    const parts: string[] = [
      `[CONFIG] ${this.configPath} declares no "version", so it was read as a 4.x config file and ` +
        'translated to the 5.0 shape in memory. The file on disk is unchanged.',
    ];

    if (translation.translated.length > 0) {
      const pairs = translation.translated.map((pair) => `${pair.from} -> ${pair.to}`).join(', ');
      parts.push(`Renamed: ${pairs}.`);
    }

    if (translation.dropped.length > 0) {
      parts.push(`Dropped (5.0 has no such key): ${translation.dropped.join(', ')}.`);
    }

    if (translation.dropped.includes('analysis')) {
      // Names the replacement rather than only the removal: a notice that says "stop doing X"
      // without saying what to do instead reads as breakage.
      parts.push(
        'The `analysis` section was removed; for model-graded gate evaluation use the `%judge` ' +
          'modifier or `gates.evaluation.defaultMode`.'
      );
    }

    parts.push(
      'Rewrite config.json in the 5.0 spellings with "version": 5 and it is read as written, ' +
        'silencing this notice. This translation is removed in 6.0.0.'
    );

    logger.warn(parts.join(' '));
  }

  /**
   * Validates the raw parsed file against the injected schema and records the result. Reports,
   * never gates: a config that fails its schema still loads, because refusing to start over a
   * typo would turn a warning into an outage.
   */
  private async checkAgainstSchema(rawConfig: Record<string, unknown>): Promise<void> {
    if (this.schemaPath === undefined) {
      this.schemaValidation = undefined;
      return;
    }

    const result = await validateConfigAgainstSchema(rawConfig, this.schemaPath);
    this.schemaValidation = result;
    this.warnOnSchemaResult(result, this.schemaPath);
  }

  /**
   * Warns only when the status + error set differs from the last one warned. An unreadable schema
   * says nothing about the config, so it is reported as unchecked, never as invalid.
   */
  private warnOnSchemaResult(result: ConfigSchemaValidationResult, schemaPath: string): void {
    if (result.status === 'valid') {
      this.lastWarnedSchemaSignature = undefined;
      return;
    }

    const signature = JSON.stringify([result.status, [...result.errors].sort()]);
    if (signature === this.lastWarnedSchemaSignature) return;
    this.lastWarnedSchemaSignature = signature;

    if (result.status === 'unavailable') {
      logger.warn(
        `[CONFIG] Could not read the config schema at ${schemaPath}, so ${this.configPath} was not ` +
          `checked against it (${result.errors.join('; ')}). The server keeps running.`
      );
      return;
    }

    for (const error of result.errors) {
      logger.warn(
        `[CONFIG] ${this.configPath} does not match its schema: ${error} — the server keeps ` +
          'running, but this setting may not take effect as written.'
      );
    }
  }

  /**
   * Start watching the configuration file for changes
   */
  startWatching(debounceMs = 500): void {
    if (this.watching) {
      return;
    }

    try {
      this.fileWatcher = watch(this.configPath, () => {
        if (this.reloadDebounceTimer) {
          clearTimeout(this.reloadDebounceTimer);
        }
        this.reloadDebounceTimer = setTimeout(() => {
          this.handleExternalConfigChange().catch((err) => {
            logger.error('Config reload failed:', err);
          });
        }, debounceMs);
      });
      this.watching = true;
      this.fileWatcher.on('error', (err) => {
        logger.error('Config file watcher error:', err);
        this.stopWatching();
      });
    } catch (error) {
      logger.error(`Failed to start config watcher for ${this.configPath}:`, error);
    }
  }

  /**
   * Stop watching the configuration file
   */
  stopWatching(): void {
    if (!this.fileWatcher) {
      return;
    }

    try {
      this.fileWatcher.close();
    } catch (error) {
      logger.error('Error closing config watcher:', error);
    }

    this.fileWatcher = undefined;
    this.watching = false;
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = undefined;
    }
  }

  /**
   * Shutdown the config manager and cleanup resources
   * Prevents async handle leaks by stopping file watcher and removing listeners
   */
  shutdown(): void {
    // Stop file watching
    this.stopWatching();

    // Remove all event listeners
    this.removeAllListeners();
  }

  private async handleExternalConfigChange(): Promise<void> {
    await this.loadConfig();
    this.emit('configChanged', this.getConfig());
  }

  private emitConfigChange(previousFrameworks: ResolvedFrameworkConfig): void {
    const currentFrameworks = this.getFrameworksConfig();
    const frameworksChanged = this.haveFrameworkConfigsChanged(
      previousFrameworks,
      currentFrameworks
    );
    this.frameworksConfigCache = { ...currentFrameworks };
    if (frameworksChanged) {
      this.emit('frameworksConfigChanged', currentFrameworks, previousFrameworks);
    }
  }

  private haveFrameworkConfigsChanged(
    a: ResolvedFrameworkConfig,
    b: ResolvedFrameworkConfig
  ): boolean {
    return (
      a.dynamicToolDescriptions !== b.dynamicToolDescriptions ||
      a.injection?.systemPrompt?.enabled !== b.injection?.systemPrompt?.enabled ||
      a.injection?.systemPrompt?.frequency !== b.injection?.systemPrompt?.frequency ||
      a.injection?.systemPrompt?.target !== b.injection?.systemPrompt?.target ||
      a.injection?.gateGuidance?.frequency !== b.injection?.gateGuidance?.frequency ||
      a.injection?.gateGuidance?.target !== b.injection?.gateGuidance?.target ||
      a.injection?.styleGuidance?.enabled !== b.injection?.styleGuidance?.enabled ||
      a.injection?.styleGuidance?.frequency !== b.injection?.styleGuidance?.frequency ||
      a.injection?.styleGuidance?.target !== b.injection?.styleGuidance?.target
    );
  }
}

/**
 * Create and initialize a configuration manager
 */
export async function createConfigLoader(configPath: string): Promise<ConfigLoader> {
  const configManager = new ConfigLoader(configPath);
  await configManager.loadConfig();
  return configManager;
}
