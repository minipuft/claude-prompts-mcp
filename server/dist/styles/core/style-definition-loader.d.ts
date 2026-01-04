/**
 * Style Definition Loader
 *
 * Loads style definitions from YAML source files at runtime,
 * following the same pattern as GateDefinitionLoader.
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of guidance.md files
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Multi-location directory resolution
 *
 * @see GateDefinitionLoader for the pattern this follows
 */
import { type StyleDefinitionYaml } from './style-schema.js';
/**
 * Configuration for StyleDefinitionLoader
 */
export interface StyleDefinitionLoaderConfig {
    /** Override default styles directory */
    stylesDir?: string;
    /** Enable caching of loaded definitions (default: true) */
    enableCache?: boolean;
    /** Validate definitions on load (default: true) */
    validateOnLoad?: boolean;
    /** Log debug information */
    debug?: boolean;
}
/**
 * Statistics from the loader
 */
export interface StyleLoaderStats {
    /** Number of cached definitions */
    cacheSize: number;
    /** Cache hit count */
    cacheHits: number;
    /** Cache miss count */
    cacheMisses: number;
    /** Number of load errors encountered */
    loadErrors: number;
    /** Styles directory being used */
    stylesDir: string;
}
export type { StyleSchemaValidationResult } from './style-schema.js';
/**
 * Style Definition Loader
 *
 * Provides runtime loading of style definitions from YAML source files.
 *
 * @example
 * ```typescript
 * const loader = new StyleDefinitionLoader();
 *
 * // Discover available styles
 * const ids = loader.discoverStyles();
 * // ['analytical', 'procedural', 'creative', 'reasoning']
 *
 * // Load a specific style
 * const definition = loader.loadStyle('analytical');
 * ```
 */
export declare class StyleDefinitionLoader {
    private cache;
    private stats;
    private stylesDir;
    private enableCache;
    private validateOnLoad;
    private debug;
    constructor(config?: StyleDefinitionLoaderConfig);
    /**
     * Load a style definition by ID
     *
     * @param id - Style ID (e.g., 'analytical', 'procedural')
     * @returns Loaded definition or undefined if not found
     */
    loadStyle(id: string): StyleDefinitionYaml | undefined;
    /**
     * Discover all available style IDs
     *
     * @returns Array of style IDs from YAML directories
     */
    discoverStyles(): string[];
    /**
     * Load all available styles
     *
     * @returns Map of ID to definition for all successfully loaded styles
     */
    loadAllStyles(): Map<string, StyleDefinitionYaml>;
    /**
     * Check if a style exists
     *
     * @param id - Style ID to check
     * @returns True if the style has a valid entry point
     */
    styleExists(id: string): boolean;
    /**
     * Clear the cache (all or specific ID)
     *
     * @param id - Optional specific ID to clear; if omitted, clears all
     */
    clearCache(id?: string): void;
    /**
     * Get loader statistics
     */
    getStats(): StyleLoaderStats;
    /**
     * Get the styles directory being used
     */
    getStylesDir(): string;
    /**
     * Load a style from YAML directory format (styles/{id}/style.yaml)
     */
    private loadFromYamlDir;
    /**
     * Inline referenced files into the definition
     */
    private inlineReferencedFiles;
    /**
     * Validate a style definition using shared Zod schema
     */
    private validateDefinition;
    /**
     * Resolve the styles directory from multiple possible locations
     *
     * Priority:
     *   1. MCP_STYLES_PATH environment variable
     *   2. Package.json resolution (npm/npx installs)
     *   3. Walk up from module location (development)
     *   4. Common relative paths (resources/styles first, then legacy styles)
     *   5. Fallback
     */
    private resolveStylesDir;
    /**
     * Resolve styles directory by finding our package.json
     */
    private resolveFromPackageJson;
    /**
     * Check if a directory contains YAML style files
     */
    private hasYamlFiles;
}
/**
 * Factory function with default configuration
 */
export declare function createStyleDefinitionLoader(config?: StyleDefinitionLoaderConfig): StyleDefinitionLoader;
/**
 * Get the default StyleDefinitionLoader instance
 * Creates one if it doesn't exist
 */
export declare function getDefaultStyleDefinitionLoader(): StyleDefinitionLoader;
/**
 * Reset the default loader (useful for testing)
 */
export declare function resetDefaultStyleDefinitionLoader(): void;
