// @lifecycle canonical - Builds script tool hot-reload config for prompt hot-reload manager.
import {
  createScriptHotReloadRegistration,
  isScriptToolFile,
} from '../scripts/hot-reload/index.js';

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
export function buildScriptAuxiliaryReloadConfig(
  logger: Logger,
  scriptLoader: ScriptToolDefinitionLoader | undefined,
  promptsDir: string
): AuxiliaryReloadConfig | undefined {
  if (!scriptLoader) {
    logger.debug('Script loader unavailable; skipping script tool hot reload wiring.');
    return undefined;
  }

  if (!promptsDir) {
    logger.debug('Prompts directory not specified; skipping script tool hot reload wiring.');
    return undefined;
  }

  try {
    const registration = createScriptHotReloadRegistration(logger, scriptLoader, promptsDir);

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    return {
      id: 'script-tool',
      directories: registration.directories,
      handler: async (event) => {
        // Only process events for script tool files
        const affectedFile = event.affectedFiles[0];
        if (!affectedFile) {
          return;
        }

        // Check if this is a script tool file
        if (!isScriptToolFile(affectedFile)) {
          return;
        }

        await registration.handler(event);
      },
      // Use the match function to filter events before handler is called
      match: (event) => {
        return event.filePath ? isScriptToolFile(event.filePath) : false;
      },
    };
  } catch (error) {
    logger.warn(
      'Failed to configure script tool hot reload; continuing without script reload:',
      error
    );
    return undefined;
  }
}
