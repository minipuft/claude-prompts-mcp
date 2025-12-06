// @lifecycle canonical - Runtime composition root for foundation dependencies.
/**
 * Runtime Context / Foundation Builder
 *
 * Constructs shared runtime dependencies (logger, config, options, transport, service manager)
 * using existing utilities to avoid duplicate initialization logic.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { ConfigManager } from '../config/index.js';
import { createLogger, EnhancedLoggingConfig, Logger } from '../logging/index.js';
import { TransportManager } from '../server/index.js';
import { ServiceManager } from '../utils/service-manager.js';
import { resolveRuntimeLaunchOptions, RuntimeLaunchOptions } from './options.js';
import { ServerRootDetector } from './startup.js';

export interface RuntimeFoundation {
  logger: Logger;
  configManager: ConfigManager;
  serviceManager: ServiceManager;
  runtimeOptions: RuntimeLaunchOptions;
  serverRoot: string;
  transport: string;
}

export interface RuntimeFoundationDependencies {
  logger?: Logger;
  configManager?: ConfigManager;
  serviceManager?: ServiceManager;
}

export async function createRuntimeFoundation(
  runtimeOptions?: RuntimeLaunchOptions,
  dependencies: RuntimeFoundationDependencies = {}
): Promise<RuntimeFoundation> {
  const options = runtimeOptions ?? resolveRuntimeLaunchOptions();
  const serverRoot = await new ServerRootDetector().determineServerRoot();
  const configPath = path.join(serverRoot, 'config.json');

  const configManager = dependencies.configManager ?? new ConfigManager(configPath);
  await configManager.loadConfig();

  const serviceManager = dependencies.serviceManager ?? new ServiceManager();

  if (!serviceManager.hasService('config-watcher')) {
    serviceManager.register({
      name: 'config-watcher',
      start: () => configManager.startWatching(),
      stop: () => configManager.stopWatching(),
    });
  }
  await serviceManager.startService('config-watcher');

  const transport = TransportManager.determineTransport(options.args, configManager);
  const loggingConfig = configManager.getLoggingConfig();
  const logDirectory = path.isAbsolute(loggingConfig.directory)
    ? loggingConfig.directory
    : path.resolve(serverRoot, loggingConfig.directory);
  const logFile = path.join(logDirectory, 'mcp-server.log');

  await fs.mkdir(logDirectory, { recursive: true });

  const enhancedLoggerConfig: EnhancedLoggingConfig = {
    logFile,
    transport,
    enableDebug: options.verbose,
    configuredLevel: loggingConfig.level,
  };

  const logger = dependencies.logger ?? createLogger(enhancedLoggerConfig);
  if (typeof (logger as any).initLogFile === 'function') {
    await (logger as any).initLogFile();
  }

  return {
    logger,
    configManager,
    serviceManager,
    runtimeOptions: options,
    serverRoot,
    transport,
  };
}
