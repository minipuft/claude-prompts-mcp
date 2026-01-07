// @lifecycle canonical - Coordinates gate selection and orchestrates the gate system.
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
import { createGateRegistry } from './registry/index.js';
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
export class GateManager extends BaseResourceManager {
    constructor(logger, config = {}) {
        super(logger, config);
        this.registry = null;
        this.stateManager = null;
    }
    // ============================================================================
    // BaseResourceManager Abstract Method Implementations
    // ============================================================================
    get managerName() {
        return 'GateManager';
    }
    async initializeRegistry() {
        this.registry = await createGateRegistry(this.logger, this.config.registryConfig);
        const stats = this.registry.getRegistryStats();
        this.logger.debug(`GateRegistry loaded with ${stats.totalGates} gates`);
    }
    applyDefaultConfig(config) {
        return {
            registryConfig: config.registryConfig ?? {},
            debug: config.debug ?? false,
        };
    }
    getResource(id) {
        return this.registry.getGuide(id);
    }
    hasResource(id) {
        return this.registry.hasGuide(id);
    }
    listResources(enabledOnly) {
        return this.registry.getAllGuides(enabledOnly);
    }
    getResourceEntries(enabledOnly) {
        return this.registry.getGuideEntries(enabledOnly);
    }
    setResourceEnabled(id, enabled) {
        return this.registry.setGuideEnabled(id, enabled);
    }
    async reloadResource(id) {
        return this.registry.reloadGuide(id);
    }
    unregisterResource(id) {
        return this.registry.unregisterGuide(id);
    }
    clearResourceCache(id) {
        const loader = this.registry.getLoader();
        loader.clearCache(id);
    }
    getResourceStats() {
        return this.registry.getRegistryStats();
    }
    isSystemEnabled() {
        if (!this.stateManager) {
            return true; // Default to enabled if no state manager
        }
        return this.stateManager.isGateSystemEnabled();
    }
    // ============================================================================
    // Domain-Specific Methods (Gate Selection & Activation)
    // ============================================================================
    /**
     * Set the gate system state manager for synchronization
     */
    setStateManager(stateManager) {
        this.stateManager = stateManager;
        this.logger.debug('GateSystemManager synchronized with GateManager');
    }
    /**
     * Check if the gate system is enabled
     */
    isGateSystemEnabled() {
        return this.isSystemEnabled();
    }
    /**
     * Select gates based on context criteria
     *
     * This is the primary method for getting gates that should be applied
     * to a given execution context.
     *
     * @param context - Selection context with category, framework, etc.
     * @returns Selection result with matched guides
     */
    selectGates(context) {
        this.ensureInitialized();
        const startTime = performance.now();
        // If gate system is disabled, return empty result
        if (!this.isSystemEnabled()) {
            return {
                guides: [],
                selectedIds: [],
                skippedIds: [],
                metadata: {
                    selectionMethod: 'explicit',
                    selectionTime: performance.now() - startTime,
                },
            };
        }
        const selectedGuides = [];
        const selectedIds = [];
        const skippedIds = [];
        // Build activation context from selection context
        const activationContext = { explicitRequest: false };
        if (context.promptCategory) {
            activationContext.promptCategory = context.promptCategory;
        }
        if (context.framework) {
            activationContext.framework = context.framework;
        }
        // Get all enabled guides
        const allGuides = this.registry.getAllGuides(context.enabledOnly ?? true);
        for (const guide of allGuides) {
            // Check if explicitly requested
            if (context.explicitGateIds?.includes(guide.gateId)) {
                selectedGuides.push(guide);
                selectedIds.push(guide.gateId);
                continue;
            }
            // Check activation rules
            if (guide.isActive(activationContext)) {
                selectedGuides.push(guide);
                selectedIds.push(guide.gateId);
            }
            else {
                skippedIds.push(guide.gateId);
            }
        }
        // Determine selection method
        let selectionMethod = 'combined';
        if (context.explicitGateIds?.length && !context.promptCategory && !context.framework) {
            selectionMethod = 'explicit';
        }
        else if (context.promptCategory && !context.framework) {
            selectionMethod = 'category';
        }
        else if (context.framework && !context.promptCategory) {
            selectionMethod = 'framework';
        }
        if (this.config.debug) {
            this.logger.debug(`Gate selection: ${selectedIds.length} selected, ${skippedIds.length} skipped [${selectionMethod}]`);
        }
        return {
            guides: selectedGuides,
            selectedIds,
            skippedIds,
            metadata: {
                selectionMethod,
                selectionTime: performance.now() - startTime,
            },
        };
    }
    /**
     * Get active gates for specific gate IDs in a given context
     *
     * @param gateIds - Gate IDs to check
     * @param context - Activation context
     * @returns Array of active gate guides
     */
    getActiveGates(gateIds, context) {
        this.ensureInitialized();
        if (!this.isSystemEnabled()) {
            return [];
        }
        const activeGuides = [];
        for (const gateId of gateIds) {
            const guide = this.registry.getGuide(gateId);
            if (guide?.isActive(context)) {
                activeGuides.push(guide);
            }
        }
        return activeGuides;
    }
    /**
     * Get the underlying gate registry
     */
    getGateRegistry() {
        this.ensureInitialized();
        return this.registry;
    }
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
    getCategoryGates(category) {
        this.ensureInitialized();
        // If gate system is disabled, return empty
        if (!this.isSystemEnabled()) {
            return [];
        }
        const normalizedCategory = category.length > 0 ? category.toLowerCase() : 'general';
        const activationContext = {
            promptCategory: normalizedCategory,
            explicitRequest: false,
        };
        // Get all enabled guides
        const allGuides = this.registry.getAllGuides(true);
        const categoryGates = allGuides
            .filter((guide) => {
            // Skip framework gates - they're handled separately via framework_gates flag
            if (guide.gateType === 'framework') {
                return false;
            }
            // Check if gate activates for this category
            return guide.isActive(activationContext);
        })
            .map((guide) => guide.gateId);
        if (this.config.debug === true) {
            const gateList = categoryGates.length > 0 ? categoryGates.join(', ') : '(none)';
            this.logger.debug(`[GateManager] getCategoryGates('${normalizedCategory}'): ${gateList}`);
        }
        return categoryGates;
    }
    /**
     * Get combined gate system status
     *
     * Overrides base class to include domain-specific fields
     */
    getStatus() {
        return {
            enabled: this.isSystemEnabled(),
            initialized: this.initialized,
            registryStats: this.initialized ? this.registry.getRegistryStats() : null,
            stateManagerConnected: this.stateManager !== null,
        };
    }
}
/**
 * Create and initialize a GateManager
 */
export async function createGateManager(logger, config) {
    const manager = new GateManager(logger, config);
    await manager.initialize();
    return manager;
}
//# sourceMappingURL=gate-manager.js.map