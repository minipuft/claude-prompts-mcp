/**
 * PathResolver - Unified Path Resolution System
 *
 * Provides centralized resolution of all configurable paths with a clear priority order:
 *   1. CLI flags (highest priority)
 *   2. MCP_*_PATH env vars (individual resource overrides)
 *   3. MCP_RESOURCES_PATH env var (unified resources base directory)
 *   4. MCP_WORKSPACE/resources (workspace subdirectory)
 *   5. Package defaults (lowest priority - npx fallback)
 *
 * Environment Variables:
 * - MCP_WORKSPACE: Full plugin/workspace directory (server/, hooks/, etc.)
 * - MCP_RESOURCES_PATH: Just the resources directory (prompts/, gates/, etc.)
 * - MCP_*_PATH: Individual resource overrides (MCP_PROMPTS_PATH, etc.)
 *
 * User Customization:
 * - Set MCP_RESOURCES_PATH to point to a directory with your custom resources
 * - The directory should contain subdirs: prompts/, gates/, methodologies/, etc.
 */
/**
 * CLI flag values parsed from command line arguments
 */
export interface PathResolverCliOptions {
    workspace?: string;
    config?: string;
    prompts?: string;
    methodologies?: string;
    gates?: string;
    scripts?: string;
}
/**
 * Configuration for PathResolver initialization
 */
export interface PathResolverConfig {
    /** CLI flag values (highest priority) */
    cli: PathResolverCliOptions;
    /** Package root directory (auto-detected) */
    packageRoot: string;
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Resolved paths result
 */
export interface ResolvedPaths {
    workspace: string;
    resources: string;
    config: string;
    prompts: string;
    methodologies: string;
    gates: string;
    scripts: string;
    styles: string;
}
/**
 * PathResolver - Centralized path resolution for all MCP server assets
 *
 * @example
 * ```typescript
 * const resolver = new PathResolver({
 *   cli: { workspace: '/path/to/workspace' },
 *   packageRoot: '/path/to/package'
 * });
 *
 * const configPath = resolver.getConfigPath();
 * const promptsPath = resolver.getPromptsPath();
 * ```
 */
export declare class PathResolver {
    private config;
    private cache;
    private debug;
    constructor(config: PathResolverConfig);
    /**
     * Get the workspace directory
     *
     * Priority:
     *   1. --workspace CLI flag
     *   2. MCP_WORKSPACE environment variable (user-defined or set by plugin hooks)
     *   3. Package root (default - npx fallback)
     */
    getWorkspace(): string;
    /**
     * Get the resources base directory
     *
     * Priority:
     *   1. MCP_RESOURCES_PATH environment variable (user's custom resources)
     *   2. ${workspace}/resources (workspace subdirectory)
     *   3. ${packageRoot}/resources (default)
     *
     * This is used as the base for all resource types (prompts, gates, etc.)
     * unless individually overridden via MCP_*_PATH variables.
     */
    getResourcesPath(): string;
    /**
     * Get config.json path
     *
     * Priority:
     *   1. --config CLI flag
     *   2. MCP_CONFIG_PATH environment variable
     *   3. ${workspace}/config.json (if workspace differs from package and file exists)
     *   4. ${packageRoot}/config.json (default)
     */
    getConfigPath(): string;
    /**
     * Get prompts directory path
     *
     * Priority:
     *   1. --prompts CLI flag
     *   2. MCP_PROMPTS_PATH environment variable
     *   3. ${resources}/prompts/ (from MCP_RESOURCES_PATH or workspace)
     *   4. ${workspace}/prompts/ (legacy, if exists)
     *   5. ${packageRoot}/resources/prompts/ (default)
     */
    getPromptsPath(): string;
    /**
     * Get methodologies directory path
     *
     * Priority:
     *   1. --methodologies CLI flag
     *   2. MCP_METHODOLOGIES_PATH environment variable
     *   3. ${resources}/methodologies (from MCP_RESOURCES_PATH or workspace)
     *   4. ${workspace}/methodologies (legacy, if exists)
     *   5. ${packageRoot}/resources/methodologies (default)
     */
    getMethodologiesPath(): string;
    /**
     * Get gates directory path
     *
     * Priority:
     *   1. --gates CLI flag
     *   2. MCP_GATES_PATH environment variable
     *   3. ${resources}/gates (from MCP_RESOURCES_PATH or workspace)
     *   4. ${workspace}/gates (legacy, if exists)
     *   5. ${packageRoot}/resources/gates (default)
     */
    getGatesPath(): string;
    /**
     * Get scripts directory path
     *
     * Priority:
     *   1. --scripts CLI flag
     *   2. MCP_SCRIPTS_PATH environment variable
     *   3. ${resources}/scripts (from MCP_RESOURCES_PATH or workspace)
     *   4. ${workspace}/scripts (legacy, if exists)
     *   5. ${packageRoot}/resources/scripts (default)
     */
    getScriptsPath(): string;
    /**
     * Get styles directory path
     *
     * Priority:
     *   1. MCP_STYLES_PATH environment variable
     *   2. ${resources}/styles (from MCP_RESOURCES_PATH or workspace)
     *   3. ${workspace}/styles (legacy, if exists)
     *   4. ${packageRoot}/resources/styles (default)
     */
    getStylesPath(): string;
    /**
     * Get all resolved paths at once
     */
    getAllPaths(): ResolvedPaths;
    /**
     * Clear the resolution cache (useful for testing or hot-reload scenarios)
     */
    clearCache(): void;
    /**
     * Get the package root directory
     */
    getPackageRoot(): string;
    /**
     * Check if a custom workspace is being used (different from package root)
     */
    isUsingCustomWorkspace(): boolean;
    /**
     * Resolve a path to absolute, handling relative paths
     */
    private resolvePath;
    /**
     * Check if a directory contains valid methodology files
     * (subdirectories with methodology.yaml)
     */
    private hasMethodologyFiles;
    /**
     * Check if a directory contains valid gate files
     * (subdirectories with gate.yaml/gate.json or flat .json files)
     */
    private hasGateFiles;
    /**
     * Check if a directory contains valid script files
     * (subdirectories with tool.yaml)
     */
    private hasScriptFiles;
    /**
     * Log resolution result if debug mode is enabled
     */
    private logResolution;
}
/**
 * Parse path-related CLI flags from command line arguments
 *
 * Supported flags:
 *   --workspace=/path
 *   --config=/path
 *   --prompts=/path
 *   --methodologies=/path
 *   --gates=/path
 *   --scripts=/path
 *
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @returns Parsed CLI options
 */
export declare function parsePathCliOptions(args: string[]): PathResolverCliOptions;
/**
 * Validate path CLI options
 *
 * @param options - Parsed CLI options
 * @returns Array of validation error messages (empty if valid)
 */
export declare function validatePathCliOptions(options: PathResolverCliOptions): string[];
/**
 * Create a PathResolver instance from command line arguments
 *
 * @param args - Command line arguments
 * @param packageRoot - Package root directory
 * @param debug - Enable debug logging
 * @returns Configured PathResolver instance
 */
export declare function createPathResolver(args: string[], packageRoot: string, debug?: boolean): PathResolver;
