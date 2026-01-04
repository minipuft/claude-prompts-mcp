import type { Logger } from '../logging/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';
import type { StyleManager } from '../styles/index.js';
/**
 * Build style auxiliary reload configuration for HotReloadManager.
 * Follows the same pattern as buildGateAuxiliaryReloadConfig.
 *
 * @param logger - Logger instance
 * @param styleManager - StyleManager instance (optional)
 * @returns AuxiliaryReloadConfig or undefined if style manager unavailable
 */
export declare function buildStyleAuxiliaryReloadConfig(logger: Logger, styleManager?: StyleManager): AuxiliaryReloadConfig | undefined;
