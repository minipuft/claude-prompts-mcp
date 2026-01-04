/**
 * Base Resource Manager
 *
 * Abstract base class that consolidates common patterns across:
 * - GateManager
 * - FrameworkManager
 * - StyleManager
 *
 * Provides unified lifecycle management, CRUD operations, and introspection.
 * Subclasses implement domain-specific behavior via abstract methods.
 *
 * @example
 * ```typescript
 * class GateManager extends BaseResourceManager<IGateGuide, GateGuideEntry> {
 *   protected get managerName() { return 'GateManager'; }
 *   protected async createRegistry() { return createGateRegistry(this.logger); }
 *   // ... implement other abstract methods
 * }
 * ```
 */
import type { ResourceManagerStats, BaseResourceManagerConfig } from './types.js';
import type { Logger } from '../../logging/index.js';
/**
 * Abstract base class for resource managers
 *
 * Provides a template for common lifecycle and CRUD operations.
 * Subclasses manage their own registry type and implement abstract methods.
 *
 * @template TResource - The type of resource being managed
 * @template TEntry - The registry entry type (domain-specific entry wrapper)
 * @template TConfig - The configuration type (must extend BaseResourceManagerConfig)
 * @template TStats - The statistics type (unconstrained to allow domain-specific stats)
 */
export declare abstract class BaseResourceManager<TResource, TEntry = unknown, TConfig extends BaseResourceManagerConfig = BaseResourceManagerConfig, TStats = ResourceManagerStats> {
    protected logger: Logger;
    protected config: TConfig;
    protected initialized: boolean;
    constructor(logger: Logger, config: TConfig);
    /**
     * Initialize the resource manager
     *
     * Must be called before using any other methods.
     * Creates the registry and loads initial resources.
     */
    initialize(): Promise<void>;
    /**
     * Check if manager is initialized
     */
    get isInitialized(): boolean;
    /**
     * Get a resource by ID
     *
     * @param id - Resource identifier (case-insensitive)
     * @returns The resource or undefined if not found/disabled
     */
    get(id: string): TResource | undefined;
    /**
     * Check if a resource exists
     *
     * @param id - Resource identifier (case-insensitive)
     * @returns true if the resource exists (regardless of enabled state)
     */
    has(id: string): boolean;
    /**
     * List all resources
     *
     * @param enabledOnly - If true, only return enabled resources (default: true)
     * @returns Array of resources
     */
    list(enabledOnly?: boolean): TResource[];
    /**
     * Get resource entries with metadata
     *
     * @param enabledOnly - If true, only return enabled entries (default: true)
     * @returns Array of entries with metadata
     */
    getEntries(enabledOnly?: boolean): TEntry[];
    /**
     * Set the enabled state of a resource
     *
     * @param id - Resource identifier (case-insensitive)
     * @param enabled - Whether to enable the resource
     * @returns true if the state was changed
     */
    setEnabled(id: string, enabled: boolean): boolean;
    /**
     * Reload a resource from disk
     *
     * @param id - Resource identifier (case-insensitive)
     * @returns true if reload was successful
     */
    reload(id: string): Promise<boolean>;
    /**
     * Unregister a resource
     *
     * @param id - Resource identifier (case-insensitive)
     * @returns true if the resource was unregistered
     */
    unregister(id: string): boolean;
    /**
     * Clear the cache
     *
     * @param id - Optional specific ID to clear; if omitted, clears all
     */
    clearCache(id?: string): void;
    /**
     * Get manager statistics
     *
     * @returns Statistics object with counts and performance metrics
     */
    getStats(): TStats;
    /**
     * Get base manager status
     *
     * Subclasses may override to add domain-specific status fields.
     *
     * @returns Status object with initialization state and enabled state
     */
    getStatus(): {
        initialized: boolean;
        enabled: boolean;
    };
    /**
     * Manager name for logging
     */
    protected abstract get managerName(): string;
    /**
     * Initialize the domain-specific registry
     *
     * Subclass should create and store its registry in this method.
     */
    protected abstract initializeRegistry(): Promise<void>;
    /**
     * Apply default configuration values
     */
    protected abstract applyDefaultConfig(config: TConfig): TConfig;
    /**
     * Get a resource by normalized ID
     */
    protected abstract getResource(id: string): TResource | undefined;
    /**
     * Check if a resource exists by normalized ID
     */
    protected abstract hasResource(id: string): boolean;
    /**
     * List all resources
     */
    protected abstract listResources(enabledOnly: boolean): TResource[];
    /**
     * Get resource entries with metadata
     */
    protected abstract getResourceEntries(enabledOnly: boolean): TEntry[];
    /**
     * Set resource enabled state
     */
    protected abstract setResourceEnabled(id: string, enabled: boolean): boolean;
    /**
     * Reload a specific resource from disk
     */
    protected abstract reloadResource(id: string): Promise<boolean>;
    /**
     * Unregister a resource
     */
    protected abstract unregisterResource(id: string): boolean;
    /**
     * Clear resource cache
     */
    protected abstract clearResourceCache(id?: string): void;
    /**
     * Get statistics
     */
    protected abstract getResourceStats(): TStats;
    /**
     * Normalize resource ID
     *
     * Default implementation converts to lowercase.
     * Override if different normalization is needed.
     */
    protected normalizeId(id: string): string;
    /**
     * Check if the system is enabled
     *
     * Default implementation returns true.
     * Override to integrate with state managers.
     */
    protected isSystemEnabled(): boolean;
    /**
     * Post-registry initialization hook
     *
     * Called after registry is created but before initialization completes.
     * Override to perform additional setup (e.g., generate derived definitions).
     */
    protected postRegistryInit(): Promise<void>;
    /**
     * Ensure manager is initialized before use
     *
     * @throws Error if manager is not initialized
     */
    protected ensureInitialized(): void;
}
