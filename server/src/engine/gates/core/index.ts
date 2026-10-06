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
import { TemporaryGateRegistry, createTemporaryGateRegistry } from './temporary-gate-registry.js';

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
  type GateDefinitionLoaderConfig,
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
  type LoadedGateDefinition,
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
   * Whether the gate master switch is on for this instance's workspace.
   *
   * Public because the shell verification executor must read the SAME source, and it
   * is the only consumer besides the `prompt_engine` surface builder. `GateManager` was
   * the obvious alternative and was never that source: it held a `stateManager` field
   * with no writer anywhere in `src/`, so its check fell through to "no state manager,
   * assume enabled" and answered `true` however the switch was set. A control built on
   * it would never have engaged. The seam methods went as dead code (R36,
   * unreached-methods baseline, 2026-09-17); the field and the check that read it
   * followed (B.95).
   *
   * This switch also reaches gate guidance: with it off for a request's scope, the
   * gate-enhancement stage selects no gates and renders no `## Inline Gates` block (P6.292).
   * The stage checks the `gates.enabled` CONFIG value first; that is a second switch with a
   * different write path, and either one being off skips the stage.
   */
  isGateSystemEnabled(scope?: StateStoreOptions): boolean {
    // If no gate system manager is set, default to enabled for backwards compatibility
    if (!this.gateStateStore) {
      return true;
    }
    // A request's own scope when the caller has one (gate enhancement, P6.292): over HTTP a
    // workspace header's toggle is that workspace's, not the launch workspace's.
    return this.gateStateStore.isGateSystemEnabled(scope ?? this.workspaceScope);
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
