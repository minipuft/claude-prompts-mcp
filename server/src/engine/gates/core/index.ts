// @lifecycle canonical - Barrel exports for gate core helpers.
/**
 * Core Gate System - Main Exports
 * Provides guidance and validation capabilities for prompt execution
 *
 * New registry-based architecture exports:
 * - GateDefinitionLoader: YAML + MD loading with caching
 * - Gate schema validation utilities
 */

import { GateStateStore } from '../gate-state-store.js';
import { createGateLoader } from './gate-loader.js';
import {
  TemporaryGateRegistry,
  createTemporaryGateRegistry,
  type TemporaryGateDefinition,
} from './temporary-gate-registry.js';

import type { StateStoreOptions } from '#shared/types/persistence.js';
import type { GateDefinitionProvider } from './gate-loader.js';

export { GateLoader, createGateLoader, type GateDefinitionProvider } from './gate-loader.js';
export {
  TemporaryGateRegistry,
  createTemporaryGateRegistry,
  type TemporaryGateDefinition as TemporaryGateRegistryDefinition,
} from './temporary-gate-registry.js';
// RuntimeGateLoader removed - redundant with GateDefinitionLoader
// Use GateDefinitionLoader for YAML+MD loading with hot-reload support

// ============================================================================
// New Registry-Based Architecture (Phase 2)
// ============================================================================

// Gate Definition Loader - YAML + MD loading with caching
export {
  GateDefinitionLoader,
  createGateDefinitionLoader,
  getDefaultGateDefinitionLoader,
  resetDefaultGateDefinitionLoader,
  type GateDefinitionLoaderConfig,
  type GateLoaderStats as GateDefinitionLoaderStats,
  type GateSchemaValidationResult,
} from './gate-definition-loader.js';

// Gate Schema - Zod validation for gate.yaml files
export {
  GateDefinitionSchema,
  GatePassCriteriaSchema,
  GateActivationSchema,
  GateRetryConfigSchema,
  validateGateSchema,
  isValidGateDefinition,
  type GateDefinitionYaml as GateDefinitionYamlSchema,
  type GatePassCriteriaYaml,
  type GateActivationYaml,
  type GateRetryConfigYaml,
} from './gate-schema.js';

export type {
  GateActivationResult,
  GatePassCriteria,
  LightweightGateDefinition,
} from '../types.js';

/**
 * Core gate system manager with temporary gate support
 */
export class LightweightGateSystem {
  private gateStateStore: GateStateStore | undefined;
  private temporaryGateRegistry: TemporaryGateRegistry | undefined;

  /** Workspace scope for gate state reads and validation metric writes. */
  private workspaceScope?: StateStoreOptions;

  constructor(
    public gateLoader: GateDefinitionProvider,
    temporaryGateRegistry?: TemporaryGateRegistry
  ) {
    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  /**
   * Set gate system manager for runtime state checking
   */
  setGateStateStore(gateStateStore: GateStateStore, scope?: StateStoreOptions): void {
    // Scope arrives with the store rather than per call: both consumers below are internal
    // decisions made mid-validation, with no request in hand. Without it they resolved to the
    // default scope, so one workspace's gate toggle was read by every other, and validation
    // metrics from every project pooled into a single row.
    this.workspaceScope = scope;
    this.gateStateStore = gateStateStore;
  }

  /**
   * Set temporary gate registry
   */
  setTemporaryGateRegistry(temporaryGateRegistry: TemporaryGateRegistry): void {
    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  /**
   * Create a temporary gate
   */
  createTemporaryGate(
    definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'>,
    scopeId?: string
  ): string | null {
    if (!this.temporaryGateRegistry) {
      return null;
    }
    return this.temporaryGateRegistry.createTemporaryGate(definition, scopeId);
  }

  /**
   * Get temporary gates for scope
   */
  getTemporaryGatesForScope(scope: string, scopeId: string): TemporaryGateDefinition[] {
    if (!this.temporaryGateRegistry) {
      return [];
    }
    return this.temporaryGateRegistry.getTemporaryGatesForScope(scope, scopeId);
  }

  /**
   * Clean up temporary gates for scope
   */
  cleanupTemporaryGates(scope: string, scopeId?: string): number {
    if (!this.temporaryGateRegistry) {
      return 0;
    }
    return this.temporaryGateRegistry.cleanupScope(scope, scopeId);
  }

  /**
   * Check if gate system is enabled
   */
  /**
   * Whether the gate master switch is on for this instance's workspace.
   *
   * Public because the shell verification executor must read the SAME source
   * this class already short-circuits guidance and validation on. The obvious
   * alternative, `GateManager.isGateSystemEnabled()`, is not that source: its
   * `setStateManager()` seam has no production caller, so it falls through to
   * "no state manager, assume enabled" and answers `true` however the switch is
   * set. A control built on it would never engage.
   */
  isGateSystemEnabled(): boolean {
    // If no gate system manager is set, default to enabled for backwards compatibility
    if (!this.gateStateStore) {
      return true;
    }
    return this.gateStateStore.isGateSystemEnabled(this.workspaceScope);
  }

  /**
   * Get guidance text for active gates
   */
  async getGuidanceText(
    gateIds: string[],
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): Promise<string[]> {
    // Check if gate system is enabled
    if (!this.isGateSystemEnabled()) {
      return []; // Return empty guidance if gates are disabled
    }

    const activation = await this.gateLoader.getActiveGates(gateIds, context);
    return activation.guidanceText;
  }

  /**
   * Get the temporary gate registry instance (enhancement)
   */
  getTemporaryGateRegistry(): TemporaryGateRegistry | undefined {
    return this.temporaryGateRegistry;
  }

  /**
   * Cleanup the lightweight gate system and sub-components
   * Prevents async handle leaks by delegating to sub-component cleanup
   */
  async cleanup(): Promise<void> {
    // Cleanup gate system manager if present
    if (
      this.gateStateStore &&
      'cleanup' in this.gateStateStore &&
      typeof (this.gateStateStore as any).cleanup === 'function'
    ) {
      try {
        await (this.gateStateStore as any).cleanup();
      } catch (error) {
        // Errors are already logged by sub-components
      }
    }

    // Cleanup temporary gate registry if present
    if (
      this.temporaryGateRegistry &&
      'cleanup' in this.temporaryGateRegistry &&
      typeof (this.temporaryGateRegistry as any).cleanup === 'function'
    ) {
      try {
        await (this.temporaryGateRegistry as any).cleanup();
      } catch (error) {
        // Errors are already logged by sub-components
      }
    }
  }
}

/**
 * Create a complete core gate system with optional temporary gate support
 */
export function createLightweightGateSystem(
  logger: any,
  gatesDirectory?: string,
  gateStateStore?: GateStateStore,
  options?: {
    provider?: GateDefinitionProvider;
    enableTemporaryGates?: boolean;
    maxMemoryGates?: number;
    defaultExpirationMs?: number;
  }
): LightweightGateSystem {
  // Create temporary gate registry if enabled
  let temporaryGateRegistry: TemporaryGateRegistry | undefined;
  if (options?.enableTemporaryGates !== false) {
    const temporaryGateOptions: Parameters<typeof createTemporaryGateRegistry>[1] = {};
    if (options?.maxMemoryGates !== undefined) {
      temporaryGateOptions.maxMemoryGates = options.maxMemoryGates;
    }
    if (options?.defaultExpirationMs !== undefined) {
      temporaryGateOptions.defaultExpirationMs = options.defaultExpirationMs;
    }
    temporaryGateRegistry = createTemporaryGateRegistry(logger, temporaryGateOptions);
  }

  const gateLoader =
    options?.provider ?? createGateLoader(logger, gatesDirectory, temporaryGateRegistry);
  const gateSystem = new LightweightGateSystem(gateLoader, temporaryGateRegistry);

  if (gateStateStore) {
    gateSystem.setGateStateStore(gateStateStore);
  }

  return gateSystem;
}
