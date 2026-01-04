// @lifecycle canonical - Runtime composition root for foundation dependencies.
/**
 * Runtime Context / Foundation Builder
 *
 * Constructs shared runtime dependencies (logger, config, options, transport, service manager)
 * using existing utilities to avoid duplicate initialization logic.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { resolveRuntimeLaunchOptions } from './options.js';
import { createPathResolver } from './paths.js';
import { ServerRootDetector } from './startup.js';
import { ConfigManager } from '../config/index.js';
import { createLogger } from '../logging/index.js';
import { TransportManager } from '../server/index.js';
import { ServiceManager } from '../utils/service-manager.js';
export async function createRuntimeFoundation(runtimeOptions, dependencies = {}) {
    const options = runtimeOptions ?? resolveRuntimeLaunchOptions();
    // Determine server root (package root) using existing detection
    const serverRoot = await new ServerRootDetector().determineServerRoot();
    // Create PathResolver with CLI options and package root
    const pathResolver = dependencies.pathResolver ?? createPathResolver(options.args, serverRoot, options.verbose);
    // Use PathResolver for config path (supports workspace override)
    const configPath = pathResolver.getConfigPath();
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
    // Log level can be overridden via CLI flag
    const effectiveLogLevel = options.logLevel ?? loggingConfig.level;
    const logDirectory = path.isAbsolute(loggingConfig.directory)
        ? loggingConfig.directory
        : path.resolve(serverRoot, loggingConfig.directory);
    const logFile = path.join(logDirectory, 'mcp-server.log');
    await fs.mkdir(logDirectory, { recursive: true });
    const enhancedLoggerConfig = {
        logFile,
        transport,
        enableDebug: options.verbose,
        configuredLevel: effectiveLogLevel,
    };
    const logger = dependencies.logger ?? createLogger(enhancedLoggerConfig);
    if (typeof logger.initLogFile === 'function') {
        await logger.initLogFile();
    }
    // Log resolved paths if verbose
    if (options.verbose) {
        logger.info('PathResolver resolved paths:', pathResolver.getAllPaths());
    }
    return {
        logger,
        configManager,
        serviceManager,
        runtimeOptions: options,
        serverRoot,
        transport,
        pathResolver,
    };
}
//# sourceMappingURL=context.js.map