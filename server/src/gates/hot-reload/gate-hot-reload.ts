// @lifecycle canonical - Coordinates gate hot reload between file watcher and registry
/**
 * Gate Hot Reload Coordinator
 *
 * Handles the integration between file system watching and gate registry,
 * enabling hot reload of gate definitions when YAML files change.
 *
 * @see MethodologyHotReloadCoordinator for the pattern this follows
 */

import { GateDefinitionLoader } from '../core/gate-definition-loader.js';
import { createGenericGateGuide } from '../registry/generic-gate-guide.js';

import type { GateRegistry } from '../registry/gate-registry.js';
import type { Logger } from '../../logging/index.js';

/**
 * Hot reload event for gates
 * Compatible with HotReloadManager's event structure
 */
export interface GateHotReloadEvent {
  type: 'gate_changed';
  reason: string;
  affectedFiles: string[];
  gateId?: string;
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
export class GateHotReloadCoordinator {
  private logger: Logger;
  private registry: GateRegistry;
  private loader: GateDefinitionLoader;
  private config: Required<Omit<GateHotReloadConfig, 'onReload'>> & Pick<GateHotReloadConfig, 'onReload'>;
  private stats: GateHotReloadStats;

  constructor(
    logger: Logger,
    registry: GateRegistry,
    loader?: GateDefinitionLoader,
    config: GateHotReloadConfig = {}
  ) {
    this.logger = logger;
    this.registry = registry;
    this.loader = loader ?? registry.getLoader();
    this.config = {
      debug: config.debug ?? false,
      reloadTimeoutMs: config.reloadTimeoutMs ?? 5000,
      onReload: config.onReload,
    };
    this.stats = {
      reloadsAttempted: 0,
      reloadsSucceeded: 0,
      reloadsFailed: 0,
    };
  }

  /**
   * Handle a gate file change event
   *
   * This method:
   * 1. Clears the gate from the loader cache
   * 2. Reloads the definition from YAML
   * 3. Re-registers the guide with the registry
   *
   * @param event - Hot reload event from the file watcher
   */
  async handleGateChange(event: GateHotReloadEvent): Promise<void> {
    this.stats.reloadsAttempted++;

    const gateId = event.gateId;
    if (!gateId) {
      this.logger.warn('Gate hot reload event missing gateId, skipping');
      this.stats.reloadsFailed++;
      return;
    }

    if (this.config.debug) {
      this.logger.debug(`Processing gate hot reload for: ${gateId}`);
    }

    try {
      // Step 1: Clear loader cache for this gate
      this.loader.clearCache(gateId);
      if (this.config.debug) {
        this.logger.debug(`Cleared cache for gate: ${gateId}`);
      }

      // Step 2: Reload definition from YAML
      const definition = this.loader.loadGate(gateId);
      if (!definition) {
        throw new Error(`Failed to load gate definition for '${gateId}'`);
      }

      if (this.config.debug) {
        this.logger.debug(`Reloaded definition for gate: ${definition.name}`);
      }

      // Step 3: Create new guide from definition
      const guide = createGenericGateGuide(definition);

      // Step 4: Re-register with registry (replace existing)
      const success = await this.registry.registerGuide(guide, true, 'yaml-runtime');
      if (!success) {
        throw new Error(`Failed to re-register gate '${gateId}' with registry`);
      }

      // Update stats
      this.stats.reloadsSucceeded++;
      this.stats.lastReloadTime = Date.now();
      this.stats.lastReloadedGate = gateId;

      // Invoke reload callback for cache invalidation
      if (this.config.onReload) {
        try {
          this.config.onReload(gateId);
        } catch (callbackError) {
          this.logger.warn(`Gate reload callback failed for '${gateId}':`, callbackError);
        }
      }

      this.logger.info(`Gate '${definition.name}' (${gateId}) hot reloaded successfully`);
    } catch (error) {
      this.stats.reloadsFailed++;
      this.logger.error(`Failed to hot reload gate '${gateId}':`, error);
      throw error;
    }
  }

  /**
   * Get hot reload statistics
   */
  getStats(): GateHotReloadStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      reloadsAttempted: 0,
      reloadsSucceeded: 0,
      reloadsFailed: 0,
    };
  }

  /**
   * Get the definition loader being used
   */
  getLoader(): GateDefinitionLoader {
    return this.loader;
  }
}

/**
 * Create a registration bundle for gate hot reload.
 * Keeps HotReloadManager generic by returning only the callback + watch paths.
 */
export function createGateHotReloadRegistration(
  logger: Logger,
  registry: GateRegistry,
  loader?: GateDefinitionLoader,
  config?: GateHotReloadConfig
): GateHotReloadRegistration {
  const definitionLoader = loader ?? registry.getLoader();
  const coordinator = new GateHotReloadCoordinator(logger, registry, definitionLoader, config);

  return {
    directories: [definitionLoader.getGatesDir()],
    handler: (event: GateHotReloadEvent) => coordinator.handleGateChange(event),
    coordinator,
  };
}

/**
 * Factory function to create a GateHotReloadCoordinator
 */
export function createGateHotReloadCoordinator(
  logger: Logger,
  registry: GateRegistry,
  loader?: GateDefinitionLoader,
  config?: GateHotReloadConfig
): GateHotReloadCoordinator {
  return new GateHotReloadCoordinator(logger, registry, loader, config);
}
