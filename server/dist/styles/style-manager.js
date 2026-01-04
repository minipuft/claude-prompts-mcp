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
import { createStyleDefinitionLoader, } from './core/index.js';
/**
 * Style Manager
 *
 * Provides orchestration for the style system, managing style selection
 * and guidance retrieval.
 *
 * @example
 * ```typescript
 * const manager = new StyleManager(logger);
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
export class StyleManager {
    constructor(logger, config = {}) {
        this.loader = null;
        this.initialized = false;
        this.logger = logger;
        this.config = {
            loaderConfig: config.loaderConfig ?? {},
            debug: config.debug ?? false,
        };
    }
    /**
     * Initialize the style manager and loader
     */
    async initialize() {
        if (this.initialized) {
            this.logger.debug('StyleManager already initialized');
            return;
        }
        this.logger.info('Initializing StyleManager...');
        const startTime = performance.now();
        try {
            // Initialize the style loader
            this.loader = createStyleDefinitionLoader({
                ...this.config.loaderConfig,
                debug: this.config.debug,
            });
            const loadTime = performance.now() - startTime;
            this.initialized = true;
            const styles = this.loader.discoverStyles();
            this.logger.info(`StyleManager initialized with ${styles.length} styles in ${loadTime.toFixed(1)}ms`);
            if (this.config.debug && styles.length > 0) {
                this.logger.debug(`Available styles: ${styles.join(', ')}`);
            }
        }
        catch (error) {
            this.logger.error('Failed to initialize StyleManager:', error);
            throw error;
        }
    }
    /**
     * Get a specific style definition by ID
     *
     * @param styleId - The style ID (case-insensitive)
     * @returns The style definition or undefined if not found
     */
    getStyle(styleId) {
        this.ensureInitialized();
        return this.loader.loadStyle(styleId);
    }
    /**
     * Get style guidance text by ID
     *
     * @param styleId - The style ID (case-insensitive)
     * @returns The guidance text or null if not found
     */
    getStyleGuidance(styleId) {
        this.ensureInitialized();
        const style = this.loader.loadStyle(styleId);
        return style?.guidance ?? null;
    }
    /**
     * Check if a style exists
     *
     * @param styleId - The style ID to check
     * @returns true if the style exists
     */
    hasStyle(styleId) {
        this.ensureInitialized();
        return this.loader.styleExists(styleId);
    }
    /**
     * List all registered style IDs
     *
     * @returns Array of style IDs
     */
    listStyles() {
        this.ensureInitialized();
        return this.loader.discoverStyles();
    }
    /**
     * Get all style definitions
     *
     * @returns Map of ID to definition
     */
    getAllStyles() {
        this.ensureInitialized();
        return this.loader.loadAllStyles();
    }
    /**
     * Check if a style is compatible with a framework
     *
     * @param styleId - The style ID
     * @param frameworkId - The framework ID to check compatibility with
     * @returns true if compatible (or no restrictions defined)
     */
    isStyleCompatible(styleId, frameworkId) {
        const style = this.getStyle(styleId);
        if (!style?.compatibleFrameworks)
            return true; // No restriction
        if (!frameworkId)
            return true;
        return style.compatibleFrameworks.some((f) => f.toUpperCase() === frameworkId.toUpperCase());
    }
    /**
     * Check if a style should be auto-applied for a given context
     *
     * @param styleId - The style ID
     * @param context - Activation context
     * @returns true if the style should be auto-applied
     */
    isStyleActive(styleId, context) {
        const style = this.getStyle(styleId);
        if (!style)
            return false;
        if (!style.enabled)
            return false;
        if (!style.activation)
            return false;
        // Check explicit request requirement
        if (style.activation.explicit_request && !context.explicitRequest) {
            return false;
        }
        // Check category match
        if (style.activation.prompt_categories?.length && context.promptCategory) {
            if (!style.activation.prompt_categories.includes(context.promptCategory)) {
                return false;
            }
        }
        // Check framework context
        if (style.activation.framework_context?.length && context.framework) {
            if (!style.activation.framework_context.some((f) => f.toUpperCase() === context.framework.toUpperCase())) {
                return false;
            }
        }
        return true;
    }
    /**
     * Clear cached style definitions
     *
     * @param styleId - Optional specific style ID to clear
     */
    clearCache(styleId) {
        this.ensureInitialized();
        this.loader.clearCache(styleId);
        if (styleId) {
            this.logger.debug(`Cleared cache for style: ${styleId}`);
        }
        else {
            this.logger.debug('Cleared all style caches');
        }
    }
    /**
     * Get loader statistics
     */
    getLoaderStats() {
        this.ensureInitialized();
        return this.loader.getStats();
    }
    /**
     * Get the underlying loader (for testing/advanced use)
     */
    getLoader() {
        this.ensureInitialized();
        return this.loader;
    }
    /**
     * Get combined style system status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            availableStyles: this.initialized ? this.loader.discoverStyles() : [],
            loaderStats: this.initialized ? this.loader.getStats() : null,
        };
    }
    // ============================================================================
    // Private Implementation
    // ============================================================================
    /**
     * Ensure the manager is initialized before operations
     */
    ensureInitialized() {
        if (!this.initialized || !this.loader) {
            throw new Error('StyleManager not initialized. Call initialize() first.');
        }
    }
}
/**
 * Create and initialize a StyleManager
 */
export async function createStyleManager(logger, config) {
    const manager = new StyleManager(logger, config);
    await manager.initialize();
    return manager;
}
//# sourceMappingURL=style-manager.js.map