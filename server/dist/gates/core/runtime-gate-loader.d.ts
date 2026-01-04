/**
 * Runtime Gate Loader
 *
 * Loads gate definitions from YAML source files at runtime (gate.yaml + guidance.md),
 * using multi-strategy path resolution that works in npx/npm installations.
 *
 * Features:
 * - Package.json-based path resolution (works for npx deep cache paths)
 * - Environment variable override (MCP_SERVER_ROOT)
 * - Walk-up directory resolution (development fallback)
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Guidance.md file inlining support
 */
import type { LightweightGateDefinition } from '../types.js';
/**
 * Configuration for RuntimeGateLoader
 */
export interface RuntimeGateLoaderConfig {
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
/**
 * Runtime Gate Loader
 *
 * Provides runtime loading of gate definitions from YAML/JSON source files,
 * with multi-strategy path resolution for npm package compatibility.
 *
 * @example
 * ```typescript
 * const loader = new RuntimeGateLoader();
 *
 * // Discover available gates
 * const ids = loader.discoverGates();
 * // ['code-quality', 'security-awareness', ...]
 *
 * // Load a specific gate
 * const definition = loader.loadGate('code-quality');
 * ```
 */
export declare class RuntimeGateLoader {
    private cache;
    private stats;
    private gatesDir;
    private enableCache;
    private validateOnLoad;
    private debug;
    constructor(config?: RuntimeGateLoaderConfig);
    /**
     * Load a gate definition by ID
     *
     * @param id - Gate ID (e.g., 'code-quality', 'security-awareness')
     * @returns Loaded definition or undefined if not found
     */
    loadGate(id: string): LightweightGateDefinition | undefined;
    /**
     * Discover all available gate IDs
     *
     * @returns Array of gate IDs that have valid definitions
     */
    discoverGates(): string[];
    /**
     * Load all available gates
     *
     * @returns Map of ID to definition for all successfully loaded gates
     */
    loadAllGates(): Map<string, LightweightGateDefinition>;
    /**
     * Check if a gate exists
     *
     * @param id - Gate ID to check
     * @returns True if the gate has a valid definition file
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
     * Resolve the gates directory from multiple possible locations
     *
     * Priority:
     *   1. MCP_GATES_PATH environment variable (new)
     *   2. MCP_SERVER_ROOT + '/gates' (legacy)
     *   3. Package.json resolution (npm/npx installs)
     *   4. Walk up from module location (development)
     *   5. Common relative paths
     *   6. Fallback
     */
    private resolveGatesDir;
    /**
     * Resolve gates directory by finding our package.json
     * This handles npx installations where the package is deep in the cache
     */
    private resolveFromPackageJson;
    /**
     * Check if a directory contains gate definition files
     */
    private hasGateFiles;
}
/**
 * Factory function with default configuration
 */
export declare function createRuntimeGateLoader(config?: RuntimeGateLoaderConfig): RuntimeGateLoader;
/**
 * Get the default runtime gate loader instance
 *
 * Creates a singleton instance on first call.
 */
export declare function getDefaultRuntimeGateLoader(): RuntimeGateLoader;
/**
 * Reset the default loader (for testing)
 */
export declare function resetDefaultRuntimeGateLoader(): void;
