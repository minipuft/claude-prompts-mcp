/**
 * Runtime Context / Foundation Builder
 *
 * Constructs shared runtime dependencies (logger, config, options, transport, service manager)
 * using existing utilities to avoid duplicate initialization logic.
 */
import { RuntimeLaunchOptions } from './options.js';
import { PathResolver } from './paths.js';
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { ServiceManager } from '../utils/service-manager.js';
import type { TransportMode } from '../types/index.js';
export interface RuntimeFoundation {
    logger: Logger;
    configManager: ConfigManager;
    serviceManager: ServiceManager;
    runtimeOptions: RuntimeLaunchOptions;
    serverRoot: string;
    transport: TransportMode;
    /** Centralized path resolver for all configurable paths */
    pathResolver: PathResolver;
}
export interface RuntimeFoundationDependencies {
    logger?: Logger;
    configManager?: ConfigManager;
    serviceManager?: ServiceManager;
    pathResolver?: PathResolver;
}
export declare function createRuntimeFoundation(runtimeOptions?: RuntimeLaunchOptions, dependencies?: RuntimeFoundationDependencies): Promise<RuntimeFoundation>;
