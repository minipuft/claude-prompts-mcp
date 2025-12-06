// @lifecycle canonical - Coordinates methodology hot reload between file watcher and registry
/**
 * Methodology Hot Reload Coordinator
 *
 * Handles the integration between file system watching and methodology registry,
 * enabling hot reload of methodology definitions when YAML files change.
 */

import type { Logger } from '../../logging/index.js';
import type { HotReloadEvent } from '../../prompts/hot-reload-manager.js';
import { RuntimeMethodologyLoader } from './runtime-methodology-loader.js';
import { createGenericGuide } from './generic-methodology-guide.js';
import type { MethodologyRegistry } from './registry.js';

/**
 * Configuration for MethodologyHotReloadCoordinator
 */
export interface MethodologyHotReloadConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Reload timeout in ms */
  reloadTimeoutMs?: number;
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

/**
 * Methodology Hot Reload Coordinator
 *
 * Coordinates between the file watching system and methodology registry to
 * enable seamless hot reload of methodology definitions.
 *
 * @example
 * ```typescript
 * const coordinator = new MethodologyHotReloadCoordinator(logger, registry, loader);
 *
 * // Register with hot reload manager
 * hotReloadManager.setMethodologyReloadCallback(
 *   (event) => coordinator.handleMethodologyChange(event)
 * );
 * ```
 */
export class MethodologyHotReloadCoordinator {
  private logger: Logger;
  private registry: MethodologyRegistry;
  private loader: RuntimeMethodologyLoader;
  private config: Required<MethodologyHotReloadConfig>;
  private stats: MethodologyHotReloadStats;

  constructor(
    logger: Logger,
    registry: MethodologyRegistry,
    loader?: RuntimeMethodologyLoader,
    config: MethodologyHotReloadConfig = {}
  ) {
    this.logger = logger;
    this.registry = registry;
    this.loader = loader ?? new RuntimeMethodologyLoader();
    this.config = {
      debug: config.debug ?? false,
      reloadTimeoutMs: config.reloadTimeoutMs ?? 5000,
    };
    this.stats = {
      reloadsAttempted: 0,
      reloadsSucceeded: 0,
      reloadsFailed: 0,
    };
  }

  /**
   * Handle a methodology file change event
   *
   * This method:
   * 1. Clears the methodology from the loader cache
   * 2. Reloads the definition from YAML
   * 3. Re-registers the guide with the registry
   *
   * @param event - Hot reload event from the file watcher
   */
  async handleMethodologyChange(event: HotReloadEvent): Promise<void> {
    this.stats.reloadsAttempted++;

    const methodologyId = event.methodologyId;
    if (!methodologyId) {
      this.logger.warn('Methodology hot reload event missing methodologyId, skipping');
      this.stats.reloadsFailed++;
      return;
    }

    if (this.config.debug) {
      this.logger.debug(`Processing methodology hot reload for: ${methodologyId}`);
    }

    try {
      // Step 1: Clear loader cache for this methodology
      this.loader.clearCache(methodologyId);
      if (this.config.debug) {
        this.logger.debug(`Cleared cache for methodology: ${methodologyId}`);
      }

      // Step 2: Reload definition from YAML
      const definition = this.loader.loadMethodology(methodologyId);
      if (!definition) {
        throw new Error(`Failed to load methodology definition for '${methodologyId}'`);
      }

      if (this.config.debug) {
        this.logger.debug(`Reloaded definition for methodology: ${definition.name}`);
      }

      // Step 3: Create new guide from definition
      const guide = createGenericGuide(definition);

      // Step 4: Re-register with registry (replace existing)
      const success = await this.registry.registerGuide(guide, true, 'yaml-runtime');
      if (!success) {
        throw new Error(`Failed to re-register methodology '${methodologyId}' with registry`);
      }

      // Update stats
      this.stats.reloadsSucceeded++;
      this.stats.lastReloadTime = Date.now();
      this.stats.lastReloadedMethodology = methodologyId;

      this.logger.info(`🔄 Methodology '${definition.name}' (${methodologyId}) hot reloaded successfully`);
    } catch (error) {
      this.stats.reloadsFailed++;
      this.logger.error(`Failed to hot reload methodology '${methodologyId}':`, error);
      throw error;
    }
  }

  /**
   * Get hot reload statistics
   */
  getStats(): MethodologyHotReloadStats {
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
   * Get the runtime loader being used
   */
  getLoader(): RuntimeMethodologyLoader {
    return this.loader;
  }
}

/**
 * Create a registration bundle for methodology hot reload.
 * Keeps HotReloadManager generic by returning only the callback + watch paths.
 */
export function createMethodologyHotReloadRegistration(
  logger: Logger,
  registry: MethodologyRegistry,
  loader?: RuntimeMethodologyLoader,
  config?: MethodologyHotReloadConfig
): MethodologyHotReloadRegistration {
  const runtimeLoader = loader ?? registry.getRuntimeLoader();
  const coordinator = new MethodologyHotReloadCoordinator(
    logger,
    registry,
    runtimeLoader,
    config
  );

  return {
    directories: [runtimeLoader.getMethodologiesDir()],
    handler: (event: HotReloadEvent) => coordinator.handleMethodologyChange(event),
    coordinator,
  };
}

/**
 * Factory function to create a MethodologyHotReloadCoordinator
 */
export function createMethodologyHotReloadCoordinator(
  logger: Logger,
  registry: MethodologyRegistry,
  loader?: RuntimeMethodologyLoader,
  config?: MethodologyHotReloadConfig
): MethodologyHotReloadCoordinator {
  return new MethodologyHotReloadCoordinator(logger, registry, loader, config);
}
