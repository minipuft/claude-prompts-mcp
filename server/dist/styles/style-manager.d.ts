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
import { Logger } from '../logging/index.js';
import { StyleDefinitionLoader, type StyleDefinitionLoaderConfig, type StyleLoaderStats, type StyleDefinitionYaml } from './core/index.js';
/**
 * Configuration for StyleManager
 */
export interface StyleManagerConfig {
    /** Configuration for the underlying StyleDefinitionLoader */
    loaderConfig?: Partial<StyleDefinitionLoaderConfig>;
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Style activation context for determining auto-application
 */
export interface StyleActivationContext {
    /** Prompt category being executed */
    promptCategory?: string;
    /** Current framework (e.g., 'CAGEERF', 'REACT') */
    framework?: string;
    /** Whether style was explicitly requested */
    explicitRequest?: boolean;
}
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
export declare class StyleManager {
    private loader;
    private logger;
    private config;
    private initialized;
    constructor(logger: Logger, config?: StyleManagerConfig);
    /**
     * Initialize the style manager and loader
     */
    initialize(): Promise<void>;
    /**
     * Get a specific style definition by ID
     *
     * @param styleId - The style ID (case-insensitive)
     * @returns The style definition or undefined if not found
     */
    getStyle(styleId: string): StyleDefinitionYaml | undefined;
    /**
     * Get style guidance text by ID
     *
     * @param styleId - The style ID (case-insensitive)
     * @returns The guidance text or null if not found
     */
    getStyleGuidance(styleId: string): string | null;
    /**
     * Check if a style exists
     *
     * @param styleId - The style ID to check
     * @returns true if the style exists
     */
    hasStyle(styleId: string): boolean;
    /**
     * List all registered style IDs
     *
     * @returns Array of style IDs
     */
    listStyles(): string[];
    /**
     * Get all style definitions
     *
     * @returns Map of ID to definition
     */
    getAllStyles(): Map<string, StyleDefinitionYaml>;
    /**
     * Check if a style is compatible with a framework
     *
     * @param styleId - The style ID
     * @param frameworkId - The framework ID to check compatibility with
     * @returns true if compatible (or no restrictions defined)
     */
    isStyleCompatible(styleId: string, frameworkId?: string): boolean;
    /**
     * Check if a style should be auto-applied for a given context
     *
     * @param styleId - The style ID
     * @param context - Activation context
     * @returns true if the style should be auto-applied
     */
    isStyleActive(styleId: string, context: StyleActivationContext): boolean;
    /**
     * Clear cached style definitions
     *
     * @param styleId - Optional specific style ID to clear
     */
    clearCache(styleId?: string): void;
    /**
     * Get loader statistics
     */
    getLoaderStats(): StyleLoaderStats;
    /**
     * Get the underlying loader (for testing/advanced use)
     */
    getLoader(): StyleDefinitionLoader;
    /**
     * Get combined style system status
     */
    getStatus(): {
        initialized: boolean;
        availableStyles: string[];
        loaderStats: StyleLoaderStats | null;
    };
    /**
     * Ensure the manager is initialized before operations
     */
    private ensureInitialized;
}
/**
 * Create and initialize a StyleManager
 */
export declare function createStyleManager(logger: Logger, config?: StyleManagerConfig): Promise<StyleManager>;
