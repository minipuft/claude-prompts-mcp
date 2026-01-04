/**
 * Gate Hot Reload Coordinator
 *
 * Handles the integration between file system watching and gate registry,
 * enabling hot reload of gate definitions when YAML files change.
 *
 * @see MethodologyHotReloadCoordinator for the pattern this follows
 */
import { GateDefinitionLoader } from '../core/gate-definition-loader.js';
import type { Logger } from '../../logging/index.js';
import type { GateRegistry } from '../registry/gate-registry.js';
/**
 * File change operation types for hot reload events
 */
export type FileChangeOperation = 'added' | 'modified' | 'removed';
/**
 * Hot reload event for gates
 * Compatible with HotReloadManager's event structure
 */
export interface GateHotReloadEvent {
    type: 'gate_changed';
    reason: string;
    affectedFiles: string[];
    gateId?: string;
    /** The type of file change (added, modified, removed) */
    changeType?: FileChangeOperation;
    timestamp: number;
    requiresFullReload: boolean;
}
/**
 * Configuration for GateHotReloadCoordinator
 */
export interface GateHotReloadConfig {
    /** Enable debug logging */
    debug?: boolean;
    /** Reload timeout in ms */
    reloadTimeoutMs?: number;
    /** Optional callback invoked after successful gate reload (for cache invalidation) */
    onReload?: (gateId: string) => void;
}
/**
 * Statistics for hot reload operations
 */
export interface GateHotReloadStats {
    reloadsAttempted: number;
    reloadsSucceeded: number;
    reloadsFailed: number;
    lastReloadTime?: number;
    lastReloadedGate?: string;
}
/**
 * Result returned when creating a gate hot reload registration
 */
export interface GateHotReloadRegistration {
    /** Directories that should be watched for gate changes */
    directories: string[];
    /** Bound handler for use with HotReloadManager */
    handler: (event: GateHotReloadEvent) => Promise<void>;
    /** Coordinator instance handling cache clear + re-register */
    coordinator: GateHotReloadCoordinator;
}
/**
 * Gate Hot Reload Coordinator
 *
 * Coordinates between the file watching system and gate registry to
 * enable seamless hot reload of gate definitions.
 *
 * @example
 * ```typescript
 * const coordinator = new GateHotReloadCoordinator(logger, registry, loader);
 *
 * // Register with hot reload manager
 * hotReloadManager.setGateReloadCallback(
 *   (event) => coordinator.handleGateChange(event)
 * );
 * ```
 */
export declare class GateHotReloadCoordinator {
    private logger;
    private registry;
    private loader;
    private config;
    private stats;
    constructor(logger: Logger, registry: GateRegistry, loader?: GateDefinitionLoader, config?: GateHotReloadConfig);
    /**
     * Handle a gate file change event
     *
     * For 'removed' events: unregisters the gate from the registry
     * For other events: reloads the definition from YAML and re-registers
     *
     * @param event - Hot reload event from the file watcher
     */
    handleGateChange(event: GateHotReloadEvent): Promise<void>;
    /**
     * Handle gate deletion - unregister from registry
     */
    private handleGateDeletion;
    /**
     * Handle gate reload - reload from YAML and re-register
     */
    private handleGateReload;
    /**
     * Get hot reload statistics
     */
    getStats(): GateHotReloadStats;
    /**
     * Reset statistics
     */
    resetStats(): void;
    /**
     * Get the definition loader being used
     */
    getLoader(): GateDefinitionLoader;
}
/**
 * Create a registration bundle for gate hot reload.
 * Keeps HotReloadManager generic by returning only the callback + watch paths.
 */
export declare function createGateHotReloadRegistration(logger: Logger, registry: GateRegistry, loader?: GateDefinitionLoader, config?: GateHotReloadConfig): GateHotReloadRegistration;
/**
 * Factory function to create a GateHotReloadCoordinator
 */
export declare function createGateHotReloadCoordinator(logger: Logger, registry: GateRegistry, loader?: GateDefinitionLoader, config?: GateHotReloadConfig): GateHotReloadCoordinator;
