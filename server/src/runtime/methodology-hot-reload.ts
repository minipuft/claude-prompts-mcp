// @lifecycle canonical - Builds methodology hot-reload config for prompt hot-reload manager.
import { createMethodologyHotReloadRegistration } from '../frameworks/methodology/index.js';

import type { Logger } from '../logging/index.js';
import type { McpToolsManager } from '../mcp-tools/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';

export function buildMethodologyAuxiliaryReloadConfig(
  logger: Logger,
  mcpToolsManager?: McpToolsManager
): AuxiliaryReloadConfig | undefined {
  const frameworkManager = mcpToolsManager?.getFrameworkManager?.();
  if (!frameworkManager) {
    logger.debug('Framework manager unavailable; skipping methodology hot reload wiring.');
    return undefined;
  }

  try {
    const registry = frameworkManager.getMethodologyRegistry();

    // Wire hot-reload callbacks to keep FrameworkManager.frameworks cache in sync
    const registration = createMethodologyHotReloadRegistration(logger, registry, undefined, {
      onMethodologyDeleted: (methodologyId: string) => {
        // Remove framework from cache when methodology is deleted
        frameworkManager.unregister(methodologyId);
        logger.debug(`Framework cache cleared for deleted methodology: ${methodologyId}`);
      },
      onMethodologyReloaded: async (methodologyId: string) => {
        // Regenerate framework definition when methodology is reloaded
        await frameworkManager.reload(methodologyId);
        logger.debug(`Framework cache refreshed for reloaded methodology: ${methodologyId}`);
      },
    });

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    return {
      id: 'methodology',
      directories: registration.directories,
      handler: registration.handler,
    };
  } catch (error) {
    logger.warn(
      'Failed to configure methodology hot reload; continuing with prompt-only reload:',
      error
    );
    return undefined;
  }
}
