// @lifecycle canonical - Runtime composition root for foundation dependencies.
/**
 * Runtime Context / Foundation Builder
 *
 * Constructs shared runtime dependencies (logger, config, options, transport, service manager)
 * using existing utilities to avoid duplicate initialization logic.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { resolveRuntimeLaunchOptions, RuntimeLaunchOptions } from './options.js';
import { PathResolver } from './paths.js';
import { resolvePackageRoot } from './startup.js';

import type { Config, ConfigManager, TransportMode } from '#shared/types/index.js';

import { ConfigLoader } from '#infra/config/index.js';
import { TransportRouter } from '#infra/http/index.js';
import { createLogger, EnhancedLoggingConfig, Logger } from '#infra/logging/index.js';
import { ServiceOrchestrator } from '#shared/utils/service-orchestrator.js';

export interface RuntimeFoundation {
  logger: Logger;
  configManager: ConfigManager;
  serviceOrchestrator: ServiceOrchestrator;
  runtimeOptions: RuntimeLaunchOptions;
  serverRoot: string;
  transport: TransportMode;
  /** Centralized path resolver for all configurable paths */
  pathResolver: PathResolver;
}

export interface RuntimeFoundationDependencies {
  logger?: Logger;
  configManager?: ConfigLoader;
  serviceOrchestrator?: ServiceOrchestrator;
  pathResolver?: PathResolver;
}

export function applyRuntimeIdentityOverrides(
  config: Config,
  runtimeOptions: RuntimeLaunchOptions
): void {
  const hasIdentityModeOverride = runtimeOptions.identityMode != null;
  const hasIdentityDefaultsOverride =
    runtimeOptions.identityDefaults != null &&
    Object.keys(runtimeOptions.identityDefaults).length > 0;

  if (!hasIdentityModeOverride && !hasIdentityDefaultsOverride) {
    return;
  }

  const identityConfig = config.identity ?? {};
  const mergedLaunchDefaults = {
    ...(identityConfig.launchDefaults ?? {}),
    ...(runtimeOptions.identityDefaults ?? {}),
  };

  config.identity = {
    ...identityConfig,
    ...(hasIdentityModeOverride ? { mode: runtimeOptions.identityMode } : {}),
    ...(Object.keys(mergedLaunchDefaults).length > 0
      ? { launchDefaults: mergedLaunchDefaults }
      : {}),
  };
}

export async function createRuntimeFoundation(
  runtimeOptions?: RuntimeLaunchOptions,
  dependencies: RuntimeFoundationDependencies = {}
): Promise<RuntimeFoundation> {
  const options = runtimeOptions ?? resolveRuntimeLaunchOptions();

  // Determine server root (package root) from bundle location
  const serverRoot = await resolvePackageRoot({
    cliOverride: options.serverRoot,
    verbose: options.verbose,
  });

  // Create PathResolver with pre-parsed CLI path options and package root
  const pathResolver =
    dependencies.pathResolver ??
    new PathResolver({ cli: options.paths, packageRoot: serverRoot, debug: options.verbose });

  // Use PathResolver for config path (supports workspace override)
  const configPath = pathResolver.getConfigPath();

  const configManager = dependencies.configManager ?? new ConfigLoader(configPath);
  await configManager.loadConfig();
  applyRuntimeIdentityOverrides(configManager.getConfig(), options);

  const serviceOrchestrator = dependencies.serviceOrchestrator ?? new ServiceOrchestrator();

  if (!serviceOrchestrator.hasService('config-watcher')) {
    serviceOrchestrator.register({
      name: 'config-watcher',
      start: () => configManager.startWatching(),
      stop: () => configManager.stopWatching(),
    });
  }
  await serviceOrchestrator.startService('config-watcher');

  const transport = TransportRouter.determineTransport(options.args, configManager);
  const loggingConfig = configManager.getLoggingConfig();

  // Log level can be overridden via CLI flag
  const effectiveLogLevel = options.logLevel ?? loggingConfig.level;

  const logDirectory = path.isAbsolute(loggingConfig.directory)
    ? loggingConfig.directory
    : path.resolve(serverRoot, loggingConfig.directory);
  const logFile = path.join(logDirectory, 'mcp-server.log');

  await fs.mkdir(logDirectory, { recursive: true });

  const enhancedLoggerConfig: EnhancedLoggingConfig = {
    logFile,
    transport,
    enableDebug: options.verbose,
    configuredLevel: effectiveLogLevel,
  };

  const logger = dependencies.logger ?? createLogger(enhancedLoggerConfig);
  if (typeof (logger as any).initLogFile === 'function') {
    await (logger as any).initLogFile();
  }

  // Log resolved paths if verbose
  if (options.verbose) {
    logger.info('PathResolver resolved paths:', pathResolver.getAllPaths());
  }

  // Expose resolved prompts path for stateless utilities (jsonUtils template rendering)
  // This bridges PathResolver with utilities that can't receive dependency injection
  process.env['PROMPTS_PATH'] = pathResolver.getPromptsPath();

  return {
    logger,
    configManager,
    serviceOrchestrator,
    runtimeOptions: options,
    serverRoot,
    transport,
    pathResolver,
  };
}
