/**
 * Gate Definition Loader
 *
 * Loads gate definitions from YAML source files at runtime,
 * following the same pattern as RuntimeMethodologyLoader.
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of guidance.md files
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Multi-location directory resolution
 *
 * @see RuntimeMethodologyLoader for the pattern this follows
 */
import { type GateDefinitionYaml } from './gate-schema.js';
/**
 * Configuration for GateDefinitionLoader
 */
export interface GateDefinitionLoaderConfig {
    /** Override default gates directory */
    gatesDir?: string;
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
export interface GateLoaderStats {
    /** Number of cached definitions */
    cacheSize: number;
    /** Cache hit count */
    cacheHits: number;
    /** Cache miss count */
    cacheMisses: number;
    /** Number of load errors encountered */
    loadErrors: number;
    /** Gates directory being used */
    gatesDir: string;
}
export type { GateSchemaValidationResult } from './gate-schema.js';
/**
 * Gate Definition Loader
 *
 * Provides runtime loading of gate definitions from YAML source files.
 *
 * @example
 * ```typescript
 * const loader = new GateDefinitionLoader();
 *
 * // Discover available gates
 * const ids = loader.discoverGates();
 * // ['code-quality', 'framework-compliance', ...]
 *
 * // Load a specific gate
 * const definition = loader.loadGate('code-quality');
 * ```
 */
export declare class GateDefinitionLoader {
    private cache;
    private stats;
    private gatesDir;
    private enableCache;
    private validateOnLoad;
    private debug;
    constructor(config?: GateDefinitionLoaderConfig);
    /**
     * Load a gate definition by ID
     *
     * @param id - Gate ID (e.g., 'code-quality', 'framework-compliance')
     * @returns Loaded definition or undefined if not found
     */
    loadGate(id: string): GateDefinitionYaml | undefined;
    /**
     * Discover all available gate IDs
     *
     * @returns Array of gate IDs from YAML directories
     */
    discoverGates(): string[];
    /**
     * Load all available gates
     *
     * @returns Map of ID to definition for all successfully loaded gates
     */
    loadAllGates(): Map<string, GateDefinitionYaml>;
    /**
     * Check if a gate exists
     *
     * @param id - Gate ID to check
     * @returns True if the gate has a valid entry point
     */
    gateExists(id: string): boolean;
    /**
     * Clear the cache (all or specific ID)
     *
     * @param id - Optional specific ID to clear; if omitted, clears all
     */
    clearCache(id?: string): void;
    /**
     * Get loader statistics
     */
    getStats(): GateLoaderStats;
    /**
     * Get the gates directory being used
     */
    getGatesDir(): string;
    /**
     * Load a gate from YAML directory format (gates/{id}/gate.yaml)
     */
    private loadFromYamlDir;
    /**
     * Inline referenced files into the definition
     */
    private inlineReferencedFiles;
    /**
     * Validate a gate definition using shared Zod schema
     */
    private validateDefinition;
    /**
     * Resolve the gates directory from multiple possible locations
     *
     * Priority:
     *   1. MCP_GATES_PATH environment variable
     *   2. Package.json resolution (npm/npx installs)
     *   3. Walk up from module location (development)
     *   4. Common relative paths (resources/gates first, then legacy)
     *   5. Fallback
     */
    private resolveGatesDir;
    /**
     * Resolve gates directory by finding our package.json
     */
    private resolveFromPackageJson;
    /**
     * Check if a directory contains YAML gate files
     */
    private hasYamlFiles;
}
/**
 * Factory function with default configuration
 */
export declare function createGateDefinitionLoader(config?: GateDefinitionLoaderConfig): GateDefinitionLoader;
/**
 * Get the default GateDefinitionLoader instance
 * Creates one if it doesn't exist
 */
export declare function getDefaultGateDefinitionLoader(): GateDefinitionLoader;
/**
 * Reset the default loader (useful for testing)
 */
export declare function resetDefaultGateDefinitionLoader(): void;
