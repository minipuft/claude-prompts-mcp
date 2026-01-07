/**
 * Gate Manager
 *
 * Orchestration layer for the gate system.
 * Extends BaseResourceManager to provide unified resource management patterns.
 *
 * Coordinates between:
 * - GateRegistry: Lifecycle management for gate guides
 * - GateSystemManager: Runtime enable/disable state
 * - Gate selection and activation logic
 */
import { BaseResourceManager } from '../core/resource-manager/index.js';
import { Logger } from '../logging/index.js';
import { GateRegistry, type GateRegistryConfig } from './registry/index.js';
import type { GateSystemManager } from './gate-state-manager.js';
import type { IGateGuide, GateActivationContext, GateSelectionContext, GateSelectionResult, GateGuideEntry, GateRegistryStats } from './types/index.js';
/**
 * Configuration for GateManager
 */
export interface GateManagerConfig {
    /** Configuration for the underlying GateRegistry */
    registryConfig?: Partial<GateRegistryConfig>;
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Gate Manager
 *
 * Provides orchestration for the gate system, managing gate selection,
 * activation, and coordination with the state manager.
 *
 * @example
 * ```typescript
 * const manager = new GateManager(logger);
 * await manager.initialize();
 *
 * // Select gates for a context
 * const result = manager.selectGates({ promptCategory: 'code' });
 * for (const guide of result.guides) {
 *   console.log(guide.getGuidance());
 * }
 * ```
 */
export declare class GateManager extends BaseResourceManager<IGateGuide, GateGuideEntry, GateManagerConfig, GateRegistryStats> {
    private registry;
    private stateManager;
    constructor(logger: Logger, config?: GateManagerConfig);
    protected get managerName(): string;
    protected initializeRegistry(): Promise<void>;
    protected applyDefaultConfig(config: GateManagerConfig): GateManagerConfig;
    protected getResource(id: string): IGateGuide | undefined;
    protected hasResource(id: string): boolean;
    protected listResources(enabledOnly: boolean): IGateGuide[];
    protected getResourceEntries(enabledOnly: boolean): GateGuideEntry[];
    protected setResourceEnabled(id: string, enabled: boolean): boolean;
    protected reloadResource(id: string): Promise<boolean>;
    protected unregisterResource(id: string): boolean;
    protected clearResourceCache(id?: string): void;
    protected getResourceStats(): GateRegistryStats;
    protected isSystemEnabled(): boolean;
    /**
     * Set the gate system state manager for synchronization
     */
    setStateManager(stateManager: GateSystemManager): void;
    /**
     * Check if the gate system is enabled
     */
    isGateSystemEnabled(): boolean;
    /**
     * Select gates based on context criteria
     *
     * This is the primary method for getting gates that should be applied
     * to a given execution context.
     *
     * @param context - Selection context with category, framework, etc.
     * @returns Selection result with matched guides
     */
    selectGates(context: GateSelectionContext): GateSelectionResult;
    /**
     * Get active gates for specific gate IDs in a given context
     *
     * @param gateIds - Gate IDs to check
     * @param context - Activation context
     * @returns Array of active gate guides
     */
    getActiveGates(gateIds: string[], context: GateActivationContext): IGateGuide[];
    /**
     * Get the underlying gate registry
     */
    getGateRegistry(): GateRegistry;
    /**
     * Get gates that auto-activate for a given category.
     *
     * Used by ExecutionPlanner to replace hardcoded autoAssignGates().
     * This method queries all gates and filters by their activation.prompt_categories
     * rules, excluding framework gates (which are handled separately via framework_gates flag).
     *
     * @param category - The prompt category (e.g., 'development', 'research', 'analysis')
     * @returns Array of gate IDs that should auto-activate for this category
     */
    getCategoryGates(category: string): string[];
    /**
     * Get combined gate system status
     *
     * Overrides base class to include domain-specific fields
     */
    getStatus(): {
        enabled: boolean;
        initialized: boolean;
        registryStats: GateRegistryStats | null;
        stateManagerConnected: boolean;
    };
}
/**
 * Create and initialize a GateManager
 */
export declare function createGateManager(logger: Logger, config?: GateManagerConfig): Promise<GateManager>;
