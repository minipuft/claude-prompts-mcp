/**
 * Runtime Methodology Loader
 *
 * Loads methodology definitions directly from YAML source files at runtime,
 * eliminating the need for build-time YAML→JSON compilation.
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of referenced files (phases.yaml, judge-prompt.md)
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Multi-location directory resolution
 */
import type { MethodologyDefinition } from './methodology-definition-types.js';
/**
 * Configuration for RuntimeMethodologyLoader
 */
export interface RuntimeMethodologyLoaderConfig {
    /** Override default methodologies directory */
    methodologiesDir?: string;
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
export interface LoaderStats {
    /** Number of cached definitions */
    cacheSize: number;
    /** Cache hit count */
    cacheHits: number;
    /** Cache miss count */
    cacheMisses: number;
    /** Number of load errors encountered */
    loadErrors: number;
    /** Methodologies directory being used */
    methodologiesDir: string;
}
export type { MethodologySchemaValidationResult } from './methodology-schema.js';
/**
 * Runtime Methodology Loader
 *
 * Provides runtime loading of methodology definitions from YAML source files,
 * replacing the build-time compilation step.
 *
 * @example
 * ```typescript
 * const loader = new RuntimeMethodologyLoader();
 *
 * // Discover available methodologies
 * const ids = loader.discoverMethodologies();
 * // ['cageerf', 'react', '5w1h', 'scamper']
 *
 * // Load a specific methodology
 * const definition = loader.loadMethodology('cageerf');
 * ```
 */
export declare class RuntimeMethodologyLoader {
    private cache;
    private stats;
    private methodologiesDir;
    private enableCache;
    private validateOnLoad;
    private debug;
    constructor(config?: RuntimeMethodologyLoaderConfig);
    /**
     * Load a methodology definition by ID
     *
     * @param id - Methodology ID (e.g., 'cageerf', 'react')
     * @returns Loaded definition or undefined if not found
     */
    loadMethodology(id: string): MethodologyDefinition | undefined;
    /**
     * Discover all available methodology IDs
     *
     * @returns Array of methodology IDs that have valid entry points
     */
    discoverMethodologies(): string[];
    /**
     * Load all available methodologies
     *
     * @returns Map of ID to definition for all successfully loaded methodologies
     */
    loadAllMethodologies(): Map<string, MethodologyDefinition>;
    /**
     * Check if a methodology exists
     *
     * @param id - Methodology ID to check
     * @returns True if the methodology has a valid entry point
     */
    methodologyExists(id: string): boolean;
    /**
     * Clear the cache (all or specific ID)
     *
     * @param id - Optional specific ID to clear; if omitted, clears all
     */
    clearCache(id?: string): void;
    /**
     * Get loader statistics
     */
    getStats(): LoaderStats;
    /**
     * Get the methodologies directory being used
     */
    getMethodologiesDir(): string;
    /**
     * Resolve the methodologies directory from multiple possible locations
     *
     * Priority:
     *   1. MCP_METHODOLOGIES_PATH environment variable
     *   2. Package.json resolution (npm/npx installs)
     *   3. Walk up from module location (development)
     *   4. Common relative paths (resources/methodologies first, then legacy)
     *   5. Fallback
     */
    private resolveMethodologiesDir;
    /**
     * Resolve methodologies directory by finding our package.json
     * This handles npx installations where the package is deep in the cache
     */
    private resolveFromPackageJson;
    /**
     * Check if a directory contains YAML methodology files
     */
    private hasYamlFiles;
    /**
     * Inline referenced files into the definition
     */
    private inlineReferencedFiles;
    /**
     * Parse judge prompt markdown into structured format
     */
    private parseJudgePrompt;
    /**
     * Validate a methodology definition using shared Zod schema
     */
    private validateDefinition;
}
/**
 * Factory function with default configuration
 */
export declare function createRuntimeMethodologyLoader(config?: RuntimeMethodologyLoaderConfig): RuntimeMethodologyLoader;
/**
 * Get the default runtime methodology loader instance
 *
 * Creates a singleton instance on first call.
 */
export declare function getDefaultRuntimeLoader(): RuntimeMethodologyLoader;
/**
 * Reset the default loader (for testing)
 */
export declare function resetDefaultRuntimeLoader(): void;
