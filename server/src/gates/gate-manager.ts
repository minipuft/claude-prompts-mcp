// @lifecycle canonical - Coordinates gate selection and orchestrates the gate system.
/**
 * Gate Manager
 *
 * Orchestration layer for the gate system, following the FrameworkManager pattern.
 * Coordinates between:
 * - GateRegistry: Lifecycle management for gate guides
 * - GateSystemManager: Runtime enable/disable state
 * - Gate selection and activation logic
 *
 * @see FrameworkManager for the pattern this follows
 */

import { Logger } from '../logging/index.js';
import { GateRegistry, createGateRegistry, type GateRegistryConfig } from './registry/index.js';
import type {
  IGateGuide,
  GateActivationContext,
  GateSelectionContext,
  GateSelectionResult,
  GateGuideEntry,
  GateRegistryStats,
} from './types/index.js';
import type { GateSystemManager } from './gate-state-manager.js';

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
export class GateManager {
  private registry: GateRegistry | null = null;
  private stateManager: GateSystemManager | null = null;
  private logger: Logger;
  private config: Required<GateManagerConfig>;
  private initialized: boolean = false;

  constructor(logger: Logger, config: GateManagerConfig = {}) {
    this.logger = logger;
    this.config = {
      registryConfig: config.registryConfig ?? {},
      debug: config.debug ?? false,
    };
  }

  /**
   * Initialize the gate manager and registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('GateManager already initialized');
      return;
    }

    this.logger.info('Initializing GateManager...');
    const startTime = performance.now();

    try {
      // Initialize the gate registry
      this.registry = await createGateRegistry(this.logger, this.config.registryConfig);

      const loadTime = performance.now() - startTime;
      this.initialized = true;

      const stats = this.registry.getRegistryStats();
      this.logger.info(
        `GateManager initialized with ${stats.totalGates} gates in ${loadTime.toFixed(1)}ms`
      );
    } catch (error) {
      this.logger.error('Failed to initialize GateManager:', error);
      throw error;
    }
  }

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
    if (!this.stateManager) {
      return true; // Default to enabled if no state manager
    }
    return this.stateManager.isGateSystemEnabled();
  }

  /**
   * Get a specific gate guide by ID
   *
   * @param gateId - The gate ID (case-insensitive)
   * @returns The gate guide or undefined if not found/disabled
   */
  getGate(gateId: string): IGateGuide | undefined {
    this.ensureInitialized();
    return this.registry!.getGuide(gateId);
  }

  /**
   * Check if a gate exists
   *
   * @param gateId - The gate ID to check
   * @returns true if the gate exists
   */
  hasGate(gateId: string): boolean {
    this.ensureInitialized();
    return this.registry!.hasGuide(gateId);
  }

  /**
   * List all registered gates
   *
   * @param enabledOnly - If true, only return enabled gates
   * @returns Array of gate guides
   */
  listGates(enabledOnly: boolean = true): IGateGuide[] {
    this.ensureInitialized();
    return this.registry!.getAllGuides(enabledOnly);
  }

  /**
   * Get gate entries with metadata
   *
   * @param enabledOnly - If true, only return enabled entries
   * @returns Array of gate guide entries
   */
  getGateEntries(enabledOnly: boolean = true): GateGuideEntry[] {
    this.ensureInitialized();
    return this.registry!.getGuideEntries(enabledOnly);
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
    if (!this.isGateSystemEnabled()) {
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
    const activationContext: GateActivationContext = {
      promptCategory: context.promptCategory,
      framework: context.framework,
      explicitRequest: false,
    };

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

    if (!this.isGateSystemEnabled()) {
      return [];
    }

    const activeGuides: IGateGuide[] = [];

    for (const gateId of gateIds) {
      const guide = this.registry!.getGuide(gateId);
      if (guide && guide.isActive(context)) {
        activeGuides.push(guide);
      }
    }

    return activeGuides;
  }

  /**
   * Enable or disable a specific gate
   *
   * @param gateId - The gate ID
   * @param enabled - Whether to enable or disable
   * @returns true if the operation succeeded
   */
  setGateEnabled(gateId: string, enabled: boolean): boolean {
    this.ensureInitialized();
    return this.registry!.setGuideEnabled(gateId, enabled);
  }

  /**
   * Reload a specific gate from its definition
   *
   * @param gateId - The gate ID to reload
   * @returns true if reload succeeded
   */
  async reloadGate(gateId: string): Promise<boolean> {
    this.ensureInitialized();
    return this.registry!.reloadGuide(gateId);
  }

  /**
   * Get the underlying gate registry
   */
  getGateRegistry(): GateRegistry {
    this.ensureInitialized();
    return this.registry!;
  }

  /**
   * Get registry statistics
   */
  getRegistryStats(): GateRegistryStats {
    this.ensureInitialized();
    return this.registry!.getRegistryStats();
  }

  /**
   * Get combined gate system status
   */
  getStatus(): {
    enabled: boolean;
    initialized: boolean;
    registryStats: GateRegistryStats | null;
    stateManagerConnected: boolean;
  } {
    return {
      enabled: this.isGateSystemEnabled(),
      initialized: this.initialized,
      registryStats: this.initialized ? this.registry!.getRegistryStats() : null,
      stateManagerConnected: this.stateManager !== null,
    };
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  /**
   * Ensure the manager is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.registry) {
      throw new Error('GateManager not initialized. Call initialize() first.');
    }
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
