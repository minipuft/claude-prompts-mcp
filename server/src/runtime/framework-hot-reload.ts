// @lifecycle canonical - Builds framework hot-reload config for the hot-reload manager.
import { createFrameworkHotReloadRegistration } from '../engine/frameworks/definitions/index.js';

import type { Logger } from '../infra/logging/index.js';
import type { McpToolRouter } from '../mcp/tools/index.js';
import type { AuxiliaryReloadConfig } from '../modules/hot-reload/hot-reload-observer.js';

export function buildFrameworkAuxiliaryReloadConfig(
  logger: Logger,
  mcpToolsManager?: McpToolRouter
): AuxiliaryReloadConfig | undefined {
  const frameworkManager = mcpToolsManager?.getFrameworkManager?.();
  if (!frameworkManager) {
    logger.debug('Framework manager unavailable; skipping methodology hot reload wiring.');
    return undefined;
  }

  try {
    const registry = frameworkManager.getFrameworkRegistry();

    // Wire hot-reload callbacks to keep FrameworkManager.frameworks cache in sync
    const registration = createFrameworkHotReloadRegistration(logger, registry, undefined, {
      onFrameworkDeleted: (frameworkId: string) => {
        // Remove framework from cache when framework is deleted
        frameworkManager.unregister(frameworkId);
        logger.debug(`Framework cache cleared for deleted methodology: ${frameworkId}`);
      },
      onFrameworkReloaded: async (frameworkId: string) => {
        // Regenerate framework definition when framework is reloaded
        await frameworkManager.reload(frameworkId);
        logger.debug(`Framework cache refreshed for reloaded methodology: ${frameworkId}`);
      },
    });

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    return {
      id: 'framework',
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
