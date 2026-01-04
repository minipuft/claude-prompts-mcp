import type { GateManager } from '../gates/gate-manager.js';
import type { Logger } from '../logging/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';
/**
 * Build gate auxiliary reload configuration for HotReloadManager.
 * Follows the same pattern as buildMethodologyAuxiliaryReloadConfig.
 *
 * @param logger - Logger instance
 * @param gateManager - GateManager instance (optional)
 * @returns AuxiliaryReloadConfig or undefined if gate manager unavailable
 */
export declare function buildGateAuxiliaryReloadConfig(logger: Logger, gateManager?: GateManager): AuxiliaryReloadConfig | undefined;
