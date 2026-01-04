/**
 * Script Tool Hot-Reload Support
 *
 * Provides cache invalidation for script tools when their definition files change.
 * Integrates with the HotReloadManager auxiliary reload system.
 *
 * Script tools are nested inside prompt directories:
 * ```
 * prompts/{category}/{prompt_id}/tools/{tool_id}/
 * ├── tool.yaml     # Configuration (triggers reload)
 * ├── schema.json   # Input schema (triggers reload)
 * ├── description.md
 * └── script.py     # Executable (no reload needed - fresh exec each time)
 * ```
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */
import type { Logger } from '../../logging/index.js';
import type { HotReloadEvent } from '../../prompts/hot-reload-manager.js';
import type { ScriptToolDefinitionLoader } from '../core/script-definition-loader.js';
/**
 * Configuration for script tool hot-reload registration.
 */
export interface ScriptHotReloadRegistration {
    /** Directories to watch (prompt directories containing tools) */
    directories: string[];
    /** Handler function for reload events */
    handler: (event: HotReloadEvent) => Promise<void>;
    /** Pattern matcher for script tool files */
    match: (filePath: string) => boolean;
}
/**
 * Create a hot-reload registration for script tools.
 *
 * @param logger - Logger instance
 * @param scriptLoader - Script tool definition loader with cache
 * @param promptsDir - Base prompts directory
 * @returns Hot-reload registration or undefined if setup fails
 */
export declare function createScriptHotReloadRegistration(logger: Logger, scriptLoader: ScriptToolDefinitionLoader, promptsDir: string): ScriptHotReloadRegistration | undefined;
/**
 * Check if a file path is a script tool configuration file.
 *
 * @param filePath - File path to check
 * @returns True if the file is a tool.yaml or schema.json in a tools directory
 */
export declare function isScriptToolFile(filePath: string): boolean;
/**
 * Extract the prompt directory from a script tool file path.
 *
 * @param filePath - Full path to a tool file
 * @returns Prompt directory path or undefined
 */
export declare function extractPromptDirFromPath(filePath: string): string | undefined;
/**
 * Extract the tool ID from a script tool file path.
 *
 * @param filePath - Full path to a tool file
 * @returns Tool ID or undefined
 */
export declare function extractToolIdFromPath(filePath: string): string | undefined;
