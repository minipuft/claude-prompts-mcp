// @lifecycle canonical - Coordinates style hot reload between file watcher and manager
/**
 * Style Hot Reload Coordinator
 *
 * Handles the integration between file system watching and style manager,
 * enabling hot reload of style definitions when YAML files change.
 *
 * @see GateHotReloadCoordinator for the pattern this follows
 */

import type { StyleDefinitionLoader, StyleDefinitionYaml } from '../core/index.js';
import type { Logger } from '../../logging/index.js';

/**
 * Hot reload event for styles
 * Compatible with HotReloadManager's event structure
 */
export interface StyleHotReloadEvent {
  type: 'style_changed';
  reason: string;
  affectedFiles: string[];
  styleId?: string;
  timestamp: number;
  requiresFullReload: boolean;
}

/**
 * Configuration for StyleHotReloadCoordinator
 */
export interface StyleHotReloadConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Reload timeout in ms */
  reloadTimeoutMs?: number;
  /** Optional callback invoked after successful style reload */
  onReload?: (styleId: string, definition: StyleDefinitionYaml) => void;
}

/**
 * Statistics for hot reload operations
 */
export interface StyleHotReloadStats {
  reloadsAttempted: number;
  reloadsSucceeded: number;
  reloadsFailed: number;
  lastReloadTime?: number;
  lastReloadedStyle?: string;
}

/**
 * Result returned when creating a style hot reload registration
 */
export interface StyleHotReloadRegistration {
  /** Directories that should be watched for style changes */
  directories: string[];
  /** Bound handler for use with HotReloadManager */
  handler: (event: StyleHotReloadEvent) => Promise<void>;
  /** Coordinator instance handling cache clear + reload */
  coordinator: StyleHotReloadCoordinator;
}

/**
 * Style Hot Reload Coordinator
 *
 * Coordinates between the file watching system and style manager to
 * enable seamless hot reload of style definitions.
 *
 * @example
 * ```typescript
 * const coordinator = new StyleHotReloadCoordinator(logger, loader);
 *
 * // Register with hot reload manager
 * hotReloadManager.registerAuxiliaryHandler({
 *   id: 'style',
 *   directories: [loader.getStylesDir()],
 *   handler: (event) => coordinator.handleStyleChange(event),
 * });
 * ```
 */
export class StyleHotReloadCoordinator {
  private logger: Logger;
  private loader: StyleDefinitionLoader;
  private config: Required<Omit<StyleHotReloadConfig, 'onReload'>> &
    Pick<StyleHotReloadConfig, 'onReload'>;
  private stats: StyleHotReloadStats;

  constructor(
    logger: Logger,
    loader: StyleDefinitionLoader,
    config: StyleHotReloadConfig = {}
  ) {
    this.logger = logger;
    this.loader = loader;
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
   * Handle a style file change event
   *
   * This method:
   * 1. Clears the style from the loader cache
   * 2. Reloads the definition from YAML
   * 3. Invokes the reload callback if provided
   *
   * @param event - Hot reload event from the file watcher
   */
  async handleStyleChange(event: StyleHotReloadEvent): Promise<void> {
    this.stats.reloadsAttempted++;

    const styleId = event.styleId;
    if (!styleId) {
      this.logger.warn('Style hot reload event missing styleId, skipping');
      this.stats.reloadsFailed++;
      return;
    }

    if (this.config.debug) {
      this.logger.debug(`Processing style hot reload for: ${styleId}`);
    }

    try {
      // Step 1: Clear loader cache for this style
      this.loader.clearCache(styleId);
      if (this.config.debug) {
        this.logger.debug(`Cleared cache for style: ${styleId}`);
      }

      // Step 2: Reload definition from YAML
      const definition = this.loader.loadStyle(styleId);
      if (!definition) {
        throw new Error(`Failed to load style definition for '${styleId}'`);
      }

      if (this.config.debug) {
        this.logger.debug(`Reloaded definition for style: ${definition.name}`);
      }

      // Update stats
      this.stats.reloadsSucceeded++;
      this.stats.lastReloadTime = Date.now();
      this.stats.lastReloadedStyle = styleId;

      // Invoke reload callback
      if (this.config.onReload) {
        try {
          this.config.onReload(styleId, definition);
        } catch (callbackError) {
          this.logger.warn(`Style reload callback failed for '${styleId}':`, callbackError);
        }
      }

      this.logger.info(`Style '${definition.name}' (${styleId}) hot reloaded successfully`);
    } catch (error) {
      this.stats.reloadsFailed++;
      this.logger.error(`Failed to hot reload style '${styleId}':`, error);
      throw error;
    }
  }

  /**
   * Get hot reload statistics
   */
  getStats(): StyleHotReloadStats {
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
  getLoader(): StyleDefinitionLoader {
    return this.loader;
  }
}

/**
 * Create a registration bundle for style hot reload.
 * Keeps HotReloadManager generic by returning only the callback + watch paths.
 */
export function createStyleHotReloadRegistration(
  logger: Logger,
  loader: StyleDefinitionLoader,
  config?: StyleHotReloadConfig
): StyleHotReloadRegistration {
  const coordinator = new StyleHotReloadCoordinator(logger, loader, config);

  return {
    directories: [loader.getStylesDir()],
    handler: (event: StyleHotReloadEvent) => coordinator.handleStyleChange(event),
    coordinator,
  };
}

/**
 * Factory function to create a StyleHotReloadCoordinator
 */
export function createStyleHotReloadCoordinator(
  logger: Logger,
  loader: StyleDefinitionLoader,
  config?: StyleHotReloadConfig
): StyleHotReloadCoordinator {
  return new StyleHotReloadCoordinator(logger, loader, config);
}
