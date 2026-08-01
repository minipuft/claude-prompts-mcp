// @lifecycle canonical - Coordinates framework hot reload between file watcher and registry
/**
 * Framework Hot Reload Coordinator
 *
 * Handles the integration between file system watching and framework registry,
 * enabling hot reload of framework definitions when YAML files change.
 */

import { createGenericGuide } from './generic-framework-guide.js';
import { RuntimeFrameworkLoader } from './runtime-framework-loader.js';

import type { FrameworkRegistry } from './registry.js';
import type { Logger } from '../../../infra/logging/index.js';
import type { HotReloadEvent } from '../../../shared/types/index.js';

/**
 * Configuration for FrameworkHotReloadCoordinator
 */
export interface FrameworkHotReloadConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Reload timeout in ms */
  reloadTimeoutMs?: number;
  /**
   * Callback invoked when a framework is deleted.
   * Use this to notify FrameworkManager to clear its frameworks Map.
   */
  onFrameworkDeleted?: (frameworkId: string) => Promise<void> | void;
  /**
   * Callback invoked when a framework is reloaded (added/modified).
   * Use this to notify FrameworkManager to refresh its framework definition.
   */
  onFrameworkReloaded?: (frameworkId: string) => Promise<void> | void;
}

/**
 * Statistics for hot reload operations
 */
export interface FrameworkHotReloadStats {
  reloadsAttempted: number;
  reloadsSucceeded: number;
  reloadsFailed: number;
  lastReloadTime?: number;
  lastReloadedFramework?: string;
}

/**
 * Result returned when creating a framework hot reload registration
 */
export interface FrameworkHotReloadRegistration {
  /** Directories that should be watched for framework changes */
  directories: string[];
  /** Bound handler for use with HotReloadObserver.setFrameworkReloadCallback */
  handler: (event: HotReloadEvent) => Promise<void>;
  /** Coordinator instance handling cache clear + re-register */
  coordinator: FrameworkHotReloadCoordinator;
}

/**
 * Framework Hot Reload Coordinator
 *
 * Coordinates between the file watching system and framework registry to
 * enable seamless hot reload of framework definitions.
 *
 * @example
 * ```typescript
 * const coordinator = new FrameworkHotReloadCoordinator(logger, registry, loader);
 *
 * // Register with hot reload manager
 * hotReloadObserver.setFrameworkReloadCallback(
 *   (event) => coordinator.handleFrameworkChange(event)
 * );
 * ```
 */
/**
 * Internal config type with required defaults but optional callbacks
 */
interface StoredHotReloadConfig {
  debug: boolean;
  reloadTimeoutMs: number;
  onFrameworkDeleted?: (frameworkId: string) => Promise<void> | void;
  onFrameworkReloaded?: (frameworkId: string) => Promise<void> | void;
}

export class FrameworkHotReloadCoordinator {
  private logger: Logger;
  private registry: FrameworkRegistry;
  private loader: RuntimeFrameworkLoader;
  private config: StoredHotReloadConfig;
  private stats: FrameworkHotReloadStats;

  constructor(
    logger: Logger,
    registry: FrameworkRegistry,
    loader?: RuntimeFrameworkLoader,
    config: FrameworkHotReloadConfig = {}
  ) {
    this.logger = logger;
    this.registry = registry;
    this.loader = loader ?? new RuntimeFrameworkLoader();
    this.config = {
      debug: config.debug ?? false,
      reloadTimeoutMs: config.reloadTimeoutMs ?? 5000,
      onFrameworkDeleted: config.onFrameworkDeleted,
      onFrameworkReloaded: config.onFrameworkReloaded,
    };
    this.stats = {
      reloadsAttempted: 0,
      reloadsSucceeded: 0,
      reloadsFailed: 0,
    };
  }

  /**
   * Handle a framework file change event
   *
   * For 'removed' events: unregisters the framework from the registry
   * For other events: reloads the definition from YAML and re-registers
   *
   * @param event - Hot reload event from the file watcher
   */
  async handleFrameworkChange(event: HotReloadEvent): Promise<void> {
    this.stats.reloadsAttempted++;

    const frameworkId = event.frameworkId;
    if (!frameworkId) {
      this.logger.warn('Framework hot reload event missing frameworkId, skipping');
      this.stats.reloadsFailed++;
      return;
    }

    if (this.config.debug) {
      this.logger.debug(
        `Processing framework hot reload for: ${frameworkId} (changeType: ${event.changeType ?? 'unknown'})`
      );
    }

    // Handle deletion events
    if (event.changeType === 'removed') {
      return this.handleFrameworkDeletion(frameworkId);
    }

    // Handle add/modify events
    return this.handleFrameworkReload(frameworkId);
  }

  /**
   * Handle framework deletion - unregister from registry and notify framework manager
   */
  private async handleFrameworkDeletion(frameworkId: string): Promise<void> {
    try {
      // Step 1: Clear loader cache
      this.loader.clearCache(frameworkId);

      // Step 2: Unregister from registry
      const removed = this.registry.unregisterGuide(frameworkId);

      // Step 3: Notify framework manager to clear its frameworks Map
      if (this.config.onFrameworkDeleted) {
        await this.config.onFrameworkDeleted(frameworkId);
      }

      if (removed) {
        this.stats.reloadsSucceeded++;
        this.stats.lastReloadTime = Date.now();
        this.stats.lastReloadedFramework = frameworkId;

        this.logger.info(`🗑️ Framework '${frameworkId}' unregistered (files deleted)`);
      } else {
        this.logger.debug(`Framework '${frameworkId}' was not registered, nothing to remove`);
        this.stats.reloadsSucceeded++; // Not a failure, just nothing to do
      }
    } catch (error) {
      this.stats.reloadsFailed++;
      this.logger.error(`Failed to unregister framework '${frameworkId}':`, error);
      throw error;
    }
  }

  /**
   * Handle framework reload - reload from YAML and re-register
   */
  private async handleFrameworkReload(frameworkId: string): Promise<void> {
    try {
      // Step 1: Clear loader cache for this framework
      this.loader.clearCache(frameworkId);
      if (this.config.debug) {
        this.logger.debug(`Cleared cache for framework: ${frameworkId}`);
      }

      // Step 2: Reload definition from YAML
      const definition = this.loader.loadFramework(frameworkId);
      if (!definition) {
        throw new Error(`Failed to load framework definition for '${frameworkId}'`);
      }

      if (this.config.debug) {
        this.logger.debug(`Reloaded definition for framework: ${definition.name}`);
      }

      // Step 3: Create new guide from definition
      const guide = createGenericGuide(definition);

      // Step 4: Re-register with registry (replace existing)
      const success = await this.registry.registerGuide(guide, true, 'yaml-runtime');
      if (!success) {
        throw new Error(`Failed to re-register framework '${frameworkId}' with registry`);
      }

      // Step 5: Notify framework manager to refresh its framework definition
      if (this.config.onFrameworkReloaded) {
        await this.config.onFrameworkReloaded(frameworkId);
      }

      // Update stats
      this.stats.reloadsSucceeded++;
      this.stats.lastReloadTime = Date.now();
      this.stats.lastReloadedFramework = frameworkId;

      this.logger.info(
        `🔄 Framework '${definition.name}' (${frameworkId}) hot reloaded successfully`
      );
    } catch (error) {
      this.stats.reloadsFailed++;
      this.logger.error(`Failed to hot reload framework '${frameworkId}':`, error);
      throw error;
    }
  }

  /**
   * Get hot reload statistics
   */
  getStats(): FrameworkHotReloadStats {
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
  getLoader(): RuntimeFrameworkLoader {
    return this.loader;
  }
}

/**
 * Create a registration bundle for framework hot reload.
 * Keeps HotReloadObserver generic by returning only the callback + watch paths.
 */
export function createFrameworkHotReloadRegistration(
  logger: Logger,
  registry: FrameworkRegistry,
  loader?: RuntimeFrameworkLoader,
  config?: FrameworkHotReloadConfig
): FrameworkHotReloadRegistration {
  const runtimeLoader = loader ?? registry.getRuntimeLoader();
  const coordinator = new FrameworkHotReloadCoordinator(logger, registry, runtimeLoader, config);

  return {
    directories: [runtimeLoader.getFrameworksDir()],
    handler: (event: HotReloadEvent) => coordinator.handleFrameworkChange(event),
    coordinator,
  };
}

/**
 * Factory function to create a FrameworkHotReloadCoordinator
 */
export function createFrameworkHotReloadCoordinator(
  logger: Logger,
  registry: FrameworkRegistry,
  loader?: RuntimeFrameworkLoader,
  config?: FrameworkHotReloadConfig
): FrameworkHotReloadCoordinator {
  return new FrameworkHotReloadCoordinator(logger, registry, loader, config);
}
