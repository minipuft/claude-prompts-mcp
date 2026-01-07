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
import { Logger } from '../logging/index.js';
import { GateRegistry, createGateRegistry, type GateRegistryConfig } from './registry/index.js';

import type { GateSystemManager } from './gate-state-manager.js';
import type {
  IGateGuide,
  GateActivationContext,
  GateSelectionContext,
  GateSelectionResult,
  GateGuideEntry,
  GateRegistryStats,
} from './types/index.js';

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
export class GateManager extends BaseResourceManager<
  IGateGuide,
  GateGuideEntry,
  GateManagerConfig,
  GateRegistryStats
> {
  private registry: GateRegistry | null = null;
  private stateManager: GateSystemManager | null = null;

  constructor(logger: Logger, config: GateManagerConfig = {}) {
    super(logger, config);
  }

  // ============================================================================
  // BaseResourceManager Abstract Method Implementations
  // ============================================================================

  protected get managerName(): string {
    return 'GateManager';
  }

  protected async initializeRegistry(): Promise<void> {
    this.registry = await createGateRegistry(this.logger, this.config.registryConfig);
    const stats = this.registry.getRegistryStats();
    this.logger.debug(`GateRegistry loaded with ${stats.totalGates} gates`);
  }

  protected applyDefaultConfig(config: GateManagerConfig): GateManagerConfig {
    return {
      registryConfig: config.registryConfig ?? {},
      debug: config.debug ?? false,
    };
  }

  protected getResource(id: string): IGateGuide | undefined {
    return this.registry!.getGuide(id);
  }

  protected hasResource(id: string): boolean {
    return this.registry!.hasGuide(id);
  }

  protected listResources(enabledOnly: boolean): IGateGuide[] {
    return this.registry!.getAllGuides(enabledOnly);
  }

  protected getResourceEntries(enabledOnly: boolean): GateGuideEntry[] {
    return this.registry!.getGuideEntries(enabledOnly);
  }

  protected setResourceEnabled(id: string, enabled: boolean): boolean {
    return this.registry!.setGuideEnabled(id, enabled);
  }

  protected async reloadResource(id: string): Promise<boolean> {
    return this.registry!.reloadGuide(id);
  }

  protected unregisterResource(id: string): boolean {
    return this.registry!.unregisterGuide(id);
  }

  protected clearResourceCache(id?: string): void {
    const loader = this.registry!.getLoader();
    loader.clearCache(id);
  }

  protected getResourceStats(): GateRegistryStats {
    return this.registry!.getRegistryStats();
  }

  protected override isSystemEnabled(): boolean {
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
  setStateManager(stateManager: GateSystemManager): void {
    this.stateManager = stateManager;
    this.logger.debug('GateSystemManager synchronized with GateManager');
  }

  /**
   * Check if the gate system is enabled
   */
  isGateSystemEnabled(): boolean {
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
  selectGates(context: GateSelectionContext): GateSelectionResult {
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

    const selectedGuides: IGateGuide[] = [];
    const selectedIds: string[] = [];
    const skippedIds: string[] = [];

    // Build activation context from selection context
    const activationContext: GateActivationContext = { explicitRequest: false };
    if (context.promptCategory) {
      activationContext.promptCategory = context.promptCategory;
    }
    if (context.framework) {
      activationContext.framework = context.framework;
    }

    // Get all enabled guides
    const allGuides = this.registry!.getAllGuides(context.enabledOnly ?? true);

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
      } else {
        skippedIds.push(guide.gateId);
      }
    }

    // Determine selection method
    let selectionMethod: 'explicit' | 'category' | 'framework' | 'combined' = 'combined';
    if (context.explicitGateIds?.length && !context.promptCategory && !context.framework) {
      selectionMethod = 'explicit';
    } else if (context.promptCategory && !context.framework) {
      selectionMethod = 'category';
    } else if (context.framework && !context.promptCategory) {
      selectionMethod = 'framework';
    }

    if (this.config.debug) {
      this.logger.debug(
        `Gate selection: ${selectedIds.length} selected, ${skippedIds.length} skipped [${selectionMethod}]`
      );
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
  getActiveGates(gateIds: string[], context: GateActivationContext): IGateGuide[] {
    this.ensureInitialized();

    if (!this.isSystemEnabled()) {
      return [];
    }

    const activeGuides: IGateGuide[] = [];

    for (const gateId of gateIds) {
      const guide = this.registry!.getGuide(gateId);
      if (guide?.isActive(context)) {
        activeGuides.push(guide);
      }
    }

    return activeGuides;
  }

  /**
   * Get the underlying gate registry
   */
  getGateRegistry(): GateRegistry {
    this.ensureInitialized();
    return this.registry!;
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
  getCategoryGates(category: string): string[] {
    this.ensureInitialized();

    // If gate system is disabled, return empty
    if (!this.isSystemEnabled()) {
      return [];
    }

    const normalizedCategory = category.length > 0 ? category.toLowerCase() : 'general';

    const activationContext: GateActivationContext = {
      promptCategory: normalizedCategory,
      explicitRequest: false,
    };

    // Get all enabled guides
    const allGuides = this.registry!.getAllGuides(true);

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
  override getStatus(): {
    enabled: boolean;
    initialized: boolean;
    registryStats: GateRegistryStats | null;
    stateManagerConnected: boolean;
  } {
    return {
      enabled: this.isSystemEnabled(),
      initialized: this.initialized,
      registryStats: this.initialized ? this.registry!.getRegistryStats() : null,
      stateManagerConnected: this.stateManager !== null,
    };
  }
}

/**
 * Create and initialize a GateManager
 */
export async function createGateManager(
  logger: Logger,
  config?: GateManagerConfig
): Promise<GateManager> {
  const manager = new GateManager(logger, config);
  await manager.initialize();
  return manager;
}
