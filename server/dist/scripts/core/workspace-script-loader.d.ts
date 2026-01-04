/**
 * Workspace Script Loader
 *
 * Provides unified script discovery and loading with priority-based resolution:
 *   1. Prompt-local: prompts/{category}/{prompt_id}/tools/{script_id}/
 *   2. Workspace:    ${workspace}/resources/scripts/{script_id}/
 *
 * First match wins (prompt-local scripts take priority over workspace scripts).
 *
 * Implements `IScriptLoader` interface for use with `ScriptReferenceResolver`.
 */
import type { IScriptLoader } from '../../execution/reference/script-reference-resolver.js';
import type { LoadedScriptTool, ScriptToolLoaderConfig } from '../types.js';
/**
 * Configuration for WorkspaceScriptLoader
 */
export interface WorkspaceScriptLoaderConfig extends ScriptToolLoaderConfig {
    /** Path to the workspace scripts directory */
    workspaceScriptsPath: string;
}
/**
 * Workspace Script Loader
 *
 * Unified loader for both prompt-local and workspace-level scripts.
 * Implements `IScriptLoader` for integration with `ScriptReferenceResolver`.
 *
 * @example
 * ```typescript
 * const loader = new WorkspaceScriptLoader({
 *   workspaceScriptsPath: '/path/to/workspace/resources/scripts'
 * });
 *
 * // Check if script exists (prompt-local first, then workspace)
 * if (loader.scriptExists('analyzer', '/path/to/prompt')) {
 *   const tool = loader.loadScript('analyzer', '/path/to/prompt');
 * }
 * ```
 */
export declare class WorkspaceScriptLoader implements IScriptLoader {
    private readonly promptLocalLoader;
    private readonly workspaceScriptsPath;
    private readonly workspaceCache;
    private readonly debug;
    private readonly validateOnLoad;
    constructor(config: WorkspaceScriptLoaderConfig);
    /**
     * Check if a script exists in any known location.
     *
     * Priority:
     *   1. Prompt-local: ${promptDir}/tools/${scriptId}/
     *   2. Workspace:    ${workspaceScriptsPath}/${scriptId}/
     *
     * @param scriptId - The script ID to look for
     * @param promptDir - Optional prompt directory for prompt-local lookup
     * @returns True if the script exists in any location
     */
    scriptExists(scriptId: string, promptDir?: string): boolean;
    /**
     * Load a script by ID from any known location.
     *
     * Priority:
     *   1. Prompt-local: ${promptDir}/tools/${scriptId}/
     *   2. Workspace:    ${workspaceScriptsPath}/${scriptId}/
     *
     * @param scriptId - The script ID to load
     * @param promptDir - Optional prompt directory for prompt-local lookup
     * @returns Loaded script tool or undefined if not found
     */
    loadScript(scriptId: string, promptDir?: string): LoadedScriptTool | undefined;
    /**
     * Get the paths that were searched for a script.
     * Used for error diagnostics.
     *
     * @param scriptId - The script ID that was searched
     * @param promptDir - Optional prompt directory
     * @returns Array of paths that were searched
     */
    getSearchedPaths(scriptId: string, promptDir?: string): string[];
    /**
     * Discover all available script IDs in the workspace scripts directory.
     *
     * @returns Array of script IDs found
     */
    discoverWorkspaceScripts(): string[];
    /**
     * Get the workspace scripts path.
     */
    getWorkspaceScriptsPath(): string;
    /**
     * Clear all caches.
     */
    clearCache(): void;
    /**
     * Load a script from the workspace scripts directory.
     * Uses direct YAML loading since workspace structure differs from prompt-local.
     */
    private loadWorkspaceScript;
    /**
     * Load referenced files from a script directory.
     */
    private loadReferencedFiles;
}
