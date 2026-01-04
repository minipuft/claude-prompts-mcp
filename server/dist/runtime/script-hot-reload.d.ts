import type { Logger } from '../logging/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';
import type { ScriptToolDefinitionLoader } from '../scripts/core/script-definition-loader.js';
/**
 * Build script tool auxiliary reload configuration for HotReloadManager.
 * Follows the same pattern as buildGateAuxiliaryReloadConfig.
 *
 * @param logger - Logger instance
 * @param scriptLoader - Script tool definition loader (optional)
 * @param promptsDir - Base prompts directory
 * @returns AuxiliaryReloadConfig or undefined if script loader unavailable
 */
export declare function buildScriptAuxiliaryReloadConfig(logger: Logger, scriptLoader: ScriptToolDefinitionLoader | undefined, promptsDir: string): AuxiliaryReloadConfig | undefined;
