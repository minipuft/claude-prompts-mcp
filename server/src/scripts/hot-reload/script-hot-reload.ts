// @lifecycle canonical - Hot-reload support for prompt-scoped script tools.
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
export function createScriptHotReloadRegistration(
  logger: Logger,
  scriptLoader: ScriptToolDefinitionLoader,
  promptsDir: string
): ScriptHotReloadRegistration | undefined {
  if (!scriptLoader || !promptsDir) {
    logger.debug('Script hot-reload: missing loader or promptsDir, skipping registration');
    return undefined;
  }

  return {
    directories: [promptsDir],
    handler: async (event: HotReloadEvent) => {
      const affectedFile = event.affectedFiles[0];
      if (!affectedFile) {
        return;
      }

      // Extract prompt directory from the file path
      const promptDir = extractPromptDirFromPath(affectedFile);
      if (!promptDir) {
        logger.debug(`Script hot-reload: could not extract prompt dir from ${affectedFile}`);
        return;
      }

      // Extract tool ID if available
      const toolId = extractToolIdFromPath(affectedFile);

      if (toolId) {
        // Clear cache for specific tool
        logger.info(`Script hot-reload: clearing cache for tool '${toolId}' in ${promptDir}`);
        scriptLoader.clearToolCache(promptDir, toolId);
      } else {
        // Clear cache for entire prompt directory
        logger.info(`Script hot-reload: clearing cache for prompt ${promptDir}`);
        scriptLoader.clearCache(promptDir);
      }
    },
    match: isScriptToolFile,
  };
}

/**
 * Check if a file path is a script tool configuration file.
 *
 * @param filePath - File path to check
 * @returns True if the file is a tool.yaml or schema.json in a tools directory
 */
export function isScriptToolFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Match patterns:
  // - */tools/*/tool.yaml
  // - */tools/*/schema.json
  // - */tools/*/description.md (for completeness)
  const toolFilePattern = /\/tools\/[^/]+\/(tool\.yaml|schema\.json|description\.md)$/i;
  return toolFilePattern.test(normalizedPath);
}

/**
 * Extract the prompt directory from a script tool file path.
 *
 * @param filePath - Full path to a tool file
 * @returns Prompt directory path or undefined
 */
export function extractPromptDirFromPath(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Find the 'tools' directory and go up one level to get prompt dir
  const toolsIndex = normalizedPath.lastIndexOf('/tools/');
  if (toolsIndex === -1) {
    return undefined;
  }

  return normalizedPath.substring(0, toolsIndex);
}

/**
 * Extract the tool ID from a script tool file path.
 *
 * @param filePath - Full path to a tool file
 * @returns Tool ID or undefined
 */
export function extractToolIdFromPath(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Match: /tools/{tool_id}/
  const match = normalizedPath.match(/\/tools\/([^/]+)\//);
  return match?.[1]?.toLowerCase();
}
