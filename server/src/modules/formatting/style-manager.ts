// @lifecycle canonical - Orchestrates style selection and provides style guidance.
/**
 * Style Manager
 *
 * Orchestration layer for the style system, following the GateManager pattern.
 * Provides:
 * - Style lookup and guidance retrieval
 * - Compatibility checking with frameworks
 * - Hot-reload support via cache invalidation
 *
 * @see GateManager for the pattern this follows
 */

import { StyleDefinitionLoader, type LoadedStyleDefinition } from './core/index.js';

import type { StyleManagerPort, Logger } from '#shared/types/index.js';

/**
 * Configuration for StyleManager
 */
export interface StyleManagerConfig {
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Style Manager
 *
 * Provides orchestration for the style system, managing style selection
 * and guidance retrieval.
 *
 * @example
 * ```typescript
 * const manager = new StyleManager(logger, getDefaultStyleDefinitionLoader());
 * await manager.initialize();
 *
 * // Get style guidance
 * const guidance = manager.getStyleGuidance('analytical');
 * console.log(guidance);
 *
 * // Check available styles
 * const styles = manager.listStyles();
 * ```
 */
export class StyleManager implements StyleManagerPort {
  /**
   * THE style loader — received, never constructed (P4.31, ruling R22).
   *
   * There is ONE `StyleDefinitionLoader` in the process: the singleton
   * `runtime/module-initializer.ts` configures with the `PathResolver`-resolved roots, whose
   * refusal record is merged into the view the resource indexer reads. This manager used to call
   * `createStyleDefinitionLoader(...)` and get a SECOND instance with a second refusal collection
   * — and because style hot reload registers against `styleManager.getLoader()`, every reload
   * after startup refreshed that second collection and left the indexed one frozen at its startup
   * contents. A style repaired after startup never reached `resource_index` without a restart, and
   * one broken after startup never left it. The two agreed only at startup, which is why nothing
   * caught it.
   *
   * `readonly`, and assigned at construction rather than in `initialize()`, so there is no window
   * in which this is null and no branch in which a second instance could be made instead.
   */
  private readonly loader: StyleDefinitionLoader;
  private logger: Logger;
  private config: Required<StyleManagerConfig>;
  private initialized: boolean = false;

  constructor(logger: Logger, loader: StyleDefinitionLoader, config: StyleManagerConfig = {}) {
    this.logger = logger;
    this.loader = loader;
    this.config = {
      debug: config.debug ?? false,
    };
  }

  /**
   * Report what the injected loader can serve, and mark the manager usable.
   *
   * No longer builds anything — the loader arrives in the constructor. What remains is the
   * startup line and setting the lifecycle flag `ensureInitialized()` checks.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('StyleManager already initialized');
      return;
    }

    this.logger.info('Initializing StyleManager...');
    const startTime = performance.now();

    const styles = this.loader.discoverStyles();
    const loadTime = performance.now() - startTime;
    this.initialized = true;

    this.logger.info(
      `StyleManager initialized with ${styles.length} styles in ${loadTime.toFixed(1)}ms`
    );

    if (this.config.debug && styles.length > 0) {
      this.logger.debug(`Available styles: ${styles.join(', ')}`);
    }
  }

  /**
   * Get a specific style definition by ID
   *
   * @param styleId - The style ID (case-insensitive)
   * @returns The style definition or undefined if not found
   */
  getStyle(styleId: string): LoadedStyleDefinition | undefined {
    this.ensureInitialized();
    return this.loader.loadStyle(styleId);
  }

  /**
   * Get style guidance text by ID
   *
   * @param styleId - The style ID (case-insensitive)
   * @returns The guidance text or null if not found
   */
  getStyleGuidance(styleId: string): string | null {
    this.ensureInitialized();
    const style = this.loader.loadStyle(styleId);
    return style?.guidance ?? null;
  }

  /**
   * List all registered style IDs
   *
   * @returns Array of style IDs
   */
  listStyles(): string[] {
    this.ensureInitialized();
    return this.loader.discoverStyles();
  }

  /**
   * Get the underlying loader (for testing/advanced use)
   */
  getLoader(): StyleDefinitionLoader {
    this.ensureInitialized();
    return this.loader;
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  /**
   * Ensure the manager is initialized before operations
   */
  private ensureInitialized(): void {
    // Lifecycle only. The `|| !this.loader` half went with the injected loader: a check that can
    // never be true is a guard standing where a defect used to live, and the one thing it could
    // still do is turn a wiring mistake into a silent lifecycle error.
    if (!this.initialized) {
      throw new Error('StyleManager not initialized. Call initialize() first.');
    }
  }
}

/**
 * Create and initialize a StyleManager over a loader the CALLER owns.
 *
 * The loader is a required argument rather than a config key with a fallback: a fallback is how
 * the second instance got built in the first place, and a fallback that only fires "when nothing
 * was passed" is exactly the shape that agrees at startup and diverges on the first reload.
 * Production passes `getDefaultStyleDefinitionLoader()`; a test passes its own
 * `createStyleDefinitionLoader({...})` and then knows precisely which instance it is driving.
 */
export async function createStyleManager(
  logger: Logger,
  loader: StyleDefinitionLoader,
  config?: StyleManagerConfig
): Promise<StyleManager> {
  const manager = new StyleManager(logger, loader, config);
  await manager.initialize();
  return manager;
}
