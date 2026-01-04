/**
 * Methodology Hot Reload Coordinator
 *
 * Handles the integration between file system watching and methodology registry,
 * enabling hot reload of methodology definitions when YAML files change.
 */
import { RuntimeMethodologyLoader } from './runtime-methodology-loader.js';
import type { MethodologyRegistry } from './registry.js';
import type { Logger } from '../../logging/index.js';
import type { HotReloadEvent } from '../../prompts/hot-reload-manager.js';
/**
 * Configuration for MethodologyHotReloadCoordinator
 */
export interface MethodologyHotReloadConfig {
    /** Enable debug logging */
    debug?: boolean;
    /** Reload timeout in ms */
    reloadTimeoutMs?: number;
    /**
     * Callback invoked when a methodology is deleted.
     * Use this to notify FrameworkManager to clear its frameworks Map.
     */
    onMethodologyDeleted?: (methodologyId: string) => Promise<void> | void;
    /**
     * Callback invoked when a methodology is reloaded (added/modified).
     * Use this to notify FrameworkManager to refresh its framework definition.
     */
    onMethodologyReloaded?: (methodologyId: string) => Promise<void> | void;
}
/**
 * Statistics for hot reload operations
 */
export interface MethodologyHotReloadStats {
    reloadsAttempted: number;
    reloadsSucceeded: number;
    reloadsFailed: number;
    lastReloadTime?: number;
    lastReloadedMethodology?: string;
}
/**
 * Result returned when creating a methodology hot reload registration
 */
export interface MethodologyHotReloadRegistration {
    /** Directories that should be watched for methodology changes */
    directories: string[];
    /** Bound handler for use with HotReloadManager.setMethodologyReloadCallback */
    handler: (event: HotReloadEvent) => Promise<void>;
    /** Coordinator instance handling cache clear + re-register */
    coordinator: MethodologyHotReloadCoordinator;
}
export declare class MethodologyHotReloadCoordinator {
    private logger;
    private registry;
    private loader;
    private config;
    private stats;
    constructor(logger: Logger, registry: MethodologyRegistry, loader?: RuntimeMethodologyLoader, config?: MethodologyHotReloadConfig);
    /**
     * Handle a methodology file change event
     *
     * For 'removed' events: unregisters the methodology from the registry
     * For other events: reloads the definition from YAML and re-registers
     *
     * @param event - Hot reload event from the file watcher
     */
    handleMethodologyChange(event: HotReloadEvent): Promise<void>;
    /**
     * Handle methodology deletion - unregister from registry and notify framework manager
     */
    private handleMethodologyDeletion;
    /**
     * Handle methodology reload - reload from YAML and re-register
     */
    private handleMethodologyReload;
    /**
     * Get hot reload statistics
     */
    getStats(): MethodologyHotReloadStats;
    /**
     * Reset statistics
     */
    resetStats(): void;
    /**
     * Get the runtime loader being used
     */
    getLoader(): RuntimeMethodologyLoader;
}
/**
 * Create a registration bundle for methodology hot reload.
 * Keeps HotReloadManager generic by returning only the callback + watch paths.
 */
export declare function createMethodologyHotReloadRegistration(logger: Logger, registry: MethodologyRegistry, loader?: RuntimeMethodologyLoader, config?: MethodologyHotReloadConfig): MethodologyHotReloadRegistration;
/**
 * Factory function to create a MethodologyHotReloadCoordinator
 */
export declare function createMethodologyHotReloadCoordinator(logger: Logger, registry: MethodologyRegistry, loader?: RuntimeMethodologyLoader, config?: MethodologyHotReloadConfig): MethodologyHotReloadCoordinator;
