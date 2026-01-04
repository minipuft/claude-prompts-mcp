/**
 * Script Tool Definition Loader
 *
 * Loads script tool definitions from YAML source files at runtime,
 * following the same pattern as GateDefinitionLoader.
 *
 * Structure:
 * ```
 * prompts/{category}/{prompt_id}/
 * └── tools/
 *     └── {tool_id}/
 *         ├── tool.yaml      # Main configuration
 *         ├── schema.json    # JSON Schema for inputs
 *         ├── description.md # Tool description
 *         └── script.py      # Executable
 * ```
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of schema.json and description.md
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Per-prompt tool discovery
 *
 * @see GateDefinitionLoader for the pattern this follows
 */
import type { LoadedScriptTool, ScriptToolLoaderConfig, ScriptToolLoaderStats } from '../types.js';
export type { ScriptToolSchemaValidationResult } from './script-schema.js';
/**
 * Script Tool Definition Loader
 *
 * Provides runtime loading of script tool definitions from YAML source files.
 * Unlike GateDefinitionLoader which uses a global directory, this loader
 * works on a per-prompt basis, loading tools from the prompt's tools/ directory.
 *
 * @example
 * ```typescript
 * const loader = new ScriptToolDefinitionLoader();
 *
 * // Discover tools for a specific prompt
 * const toolIds = loader.discoverTools('/path/to/prompts/analysis/data_analyzer');
 * // ['analyze_csv', 'generate_chart']
 *
 * // Load a specific tool
 * const tool = loader.loadTool('/path/to/prompts/analysis/data_analyzer', 'analyze_csv');
 *
 * // Load all tools declared by a prompt
 * const tools = loader.loadToolsForPrompt('/path/to/prompts/analysis/data_analyzer', ['analyze_csv']);
 * ```
 */
export declare class ScriptToolDefinitionLoader {
    private cache;
    private stats;
    private enableCache;
    private validateOnLoad;
    private debug;
    constructor(config?: ScriptToolLoaderConfig);
    /**
     * Load a script tool definition by ID from a prompt directory.
     *
     * @param promptDir - Absolute path to the prompt directory
     * @param toolId - Tool ID (directory name under tools/)
     * @param promptId - ID of the parent prompt (for LoadedScriptTool)
     * @returns Loaded tool definition or undefined if not found
     */
    loadTool(promptDir: string, toolId: string, promptId: string): LoadedScriptTool | undefined;
    /**
     * Discover all available tool IDs in a prompt's tools/ directory.
     *
     * @param promptDir - Absolute path to the prompt directory
     * @returns Array of tool IDs found
     */
    discoverTools(promptDir: string): string[];
    /**
     * Load multiple tools for a prompt.
     *
     * @param promptDir - Absolute path to the prompt directory
     * @param toolIds - Array of tool IDs to load
     * @param promptId - ID of the parent prompt
     * @returns Array of successfully loaded tools
     */
    loadToolsForPrompt(promptDir: string, toolIds: string[], promptId: string): LoadedScriptTool[];
    /**
     * Load all available tools for a prompt (discovery + load).
     *
     * @param promptDir - Absolute path to the prompt directory
     * @param promptId - ID of the parent prompt
     * @returns Array of all successfully loaded tools
     */
    loadAllToolsForPrompt(promptDir: string, promptId: string): LoadedScriptTool[];
    /**
     * Check if a tool exists in a prompt's tools/ directory.
     *
     * @param promptDir - Absolute path to the prompt directory
     * @param toolId - Tool ID to check
     * @returns True if the tool has a valid entry point
     */
    toolExists(promptDir: string, toolId: string): boolean;
    /**
     * Clear the cache (all or for a specific prompt directory).
     *
     * @param promptDir - Optional prompt directory to clear cache for
     */
    clearCache(promptDir?: string): void;
    /**
     * Clear cache for a specific tool.
     *
     * @param promptDir - Absolute path to the prompt directory
     * @param toolId - Tool ID to clear
     */
    clearToolCache(promptDir: string, toolId: string): void;
    /**
     * Get loader statistics.
     */
    getStats(): ScriptToolLoaderStats;
    /**
     * Load a tool from its directory (tools/{id}/).
     */
    private loadFromToolDir;
    /**
     * Load and inline referenced files (schema.json, description.md).
     */
    private loadReferencedFiles;
    /**
     * Validate a tool definition using Zod schema.
     */
    private validateDefinition;
    /**
     * Resolve execution config with defaults applied.
     *
     * Handles deprecation and migration of:
     * - 'parameter_match' trigger (use 'schema_match')
     * - 'confidence' field (use 'strict' for matching control)
     * - 'mode' field (use 'trigger: explicit' or 'confirm: true')
     *
     * Migration from deprecated mode field:
     * - mode: manual  → trigger: explicit
     * - mode: confirm → confirm: true
     *
     * @param yamlConfig - Execution config from YAML (may be undefined or partial)
     * @returns Complete execution config with defaults
     */
    private resolveExecutionConfig;
}
/**
 * Factory function with default configuration.
 */
export declare function createScriptToolDefinitionLoader(config?: ScriptToolLoaderConfig): ScriptToolDefinitionLoader;
/**
 * Get the default ScriptToolDefinitionLoader instance.
 * Creates one if it doesn't exist.
 */
export declare function getDefaultScriptToolDefinitionLoader(): ScriptToolDefinitionLoader;
/**
 * Reset the default loader (useful for testing).
 */
export declare function resetDefaultScriptToolDefinitionLoader(): void;
